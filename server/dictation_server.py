#!/usr/bin/env python3
"""Voice Dictation Server - WebSocket-based Pipecat Server.

A WebSocket server that receives audio from a Tauri client,
processes it through STT and LLM cleanup, and returns cleaned text.

Usage:
    python dictation_server.py
    python dictation_server.py --port 8765
"""

import asyncio
from typing import Any

import typer
import uvicorn
from loguru import logger
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import (
    Frame,
    InputAudioRawFrame,
    MetricsFrame,
    OutputTransportMessageFrame,
    TranscriptionFrame,
    UserSpeakingFrame,
    UserStartedSpeakingFrame,
    UserStoppedSpeakingFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.serializers.protobuf import ProtobufFrameSerializer
from pipecat.transports.websocket.server import (
    WebsocketServerParams,
    WebsocketServerTransport,
)

from api.config_server import app as config_api_app
from api.config_server import set_llm_converter
from config.settings import Settings
from processors.llm_cleanup import LLMResponseToRTVIConverter, TranscriptionToLLMConverter
from processors.transcription_buffer import TranscriptionBufferProcessor
from services.llm_service import create_llm_service
from services.stt_service import create_stt_service
from utils.logger import configure_logging

# CLI app
app = typer.Typer(help="Voice dictation WebSocket server")


class DebugFrameProcessor(FrameProcessor):
    """Debug processor that logs important frames for troubleshooting.

    Filters out noisy frames (UserSpeakingFrame, MetricsFrame) and only logs
    significant events like speech start/stop and transcriptions.
    """

    def __init__(self, name: str = "debug", **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._name = name
        self._audio_frame_count = 0

    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
        await super().process_frame(frame, direction)

        if isinstance(frame, InputAudioRawFrame):
            self._audio_frame_count += 1
            # Only log first few and periodic audio frames
            if self._audio_frame_count <= 3 or self._audio_frame_count % 500 == 0:
                logger.info(
                    f"[{self._name}] Audio frame #{self._audio_frame_count}: "
                    f"{len(frame.audio)} bytes, {frame.sample_rate}Hz, {frame.num_channels}ch"
                )
        elif isinstance(frame, TranscriptionFrame):
            logger.info(f"[{self._name}] TRANSCRIPTION: '{frame.text}'")
        elif isinstance(frame, UserStartedSpeakingFrame):
            logger.info(f"[{self._name}] Speech started")
        elif isinstance(frame, UserStoppedSpeakingFrame):
            logger.info(f"[{self._name}] Speech stopped")
        # Skip noisy frames: UserSpeakingFrame (fires every ~15ms), MetricsFrame
        elif not isinstance(frame, (UserSpeakingFrame, MetricsFrame)):
            logger.debug(f"[{self._name}] Frame: {type(frame).__name__}")

        await self.push_frame(frame, direction)


class TextResponseProcessor(FrameProcessor):
    """Processor that logs message frames being sent back to the client.

    This processor sits at the end of the pipeline before transport.output()
    to log the final cleaned text being sent to the Tauri client.
    """

    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
        """Process frames and log OutputTransportMessageFrames.

        Args:
            frame: The frame to process
            direction: The direction of frame flow
        """
        await super().process_frame(frame, direction)

        if isinstance(frame, OutputTransportMessageFrame):
            data = frame.message.get("data", {})
            text = data.get("text", "")
            logger.info(f"Sending to client: '{text}'")

        await self.push_frame(frame, direction)


async def run_server(host: str, port: int, settings: Settings) -> None:
    """Run the WebSocket dictation server.

    Args:
        host: Host to bind to
        port: Port to listen on
        settings: Application settings
    """
    logger.info(f"Starting WebSocket server on ws://{host}:{port}")

    # Create WebSocket transport with protobuf serializer for pipecat-ai/client-js compatibility
    # VAD filters background noise - only speech is processed by STT
    transport = WebsocketServerTransport(
        host=host,
        port=port,
        params=WebsocketServerParams(
            audio_in_enabled=True,
            audio_out_enabled=False,  # No audio output for dictation
            serializer=ProtobufFrameSerializer(),  # Required for @pipecat-ai/websocket-transport
            vad_enabled=True,
            vad_audio_passthrough=True,  # Pass audio through but with VAD state
            vad_analyzer=SileroVADAnalyzer(
                params=VADParams(
                    confidence=0.7,  # Speech detection threshold
                    start_secs=0.2,  # Time before SPEAKING state
                    stop_secs=0.8,  # Silence time before QUIET state
                    min_volume=0.6,  # Minimum volume threshold
                )
            ),
        ),
    )

    # Initialize services
    stt_service = create_stt_service(settings)
    llm_service = create_llm_service(settings)

    # Initialize processors
    debug_input = DebugFrameProcessor(name="input")
    debug_after_stt = DebugFrameProcessor(name="after-stt")
    transcription_to_llm = TranscriptionToLLMConverter()
    transcription_buffer = TranscriptionBufferProcessor()

    # Share converter with FastAPI config server
    set_llm_converter(transcription_to_llm)
    llm_response_converter = LLMResponseToRTVIConverter()
    text_response = TextResponseProcessor()

    # Build pipeline: Audio -> STT -> Buffer -> LLM Converter -> LLM -> Response Converter -> Output
    # Uses idiomatic Pipecat frame-based pattern:
    # 1. TranscriptionToLLMConverter: Converts transcription to OpenAILLMContextFrame
    # 2. LLM Service: Processes context and streams TextFrames
    # 3. LLMResponseToRTVIConverter: Aggregates response and sends RTVI message
    pipeline = Pipeline(
        [
            transport.input(),  # Audio from Tauri client
            debug_input,  # Debug: log all incoming frames
            stt_service,  # Speech-to-text (produces partial transcriptions)
            debug_after_stt,  # Debug: log frames after STT
            transcription_buffer,  # Buffer until user stops speaking
            transcription_to_llm,  # Convert transcription to LLM context
            llm_service,  # LLM-based text cleanup (streams response)
            llm_response_converter,  # Aggregate and convert to RTVI message
            text_response,  # Log outgoing text
            transport.output(),  # Send text back to client
        ]
    )

    # Create pipeline task
    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            allow_interruptions=False,
            enable_metrics=True,
            enable_usage_metrics=True,
        ),
        idle_timeout_secs=None,  # Disable idle timeout - client manages connection
    )

    # Set up event handlers
    @transport.event_handler("on_client_connected")
    async def on_client_connected(_transport: Any, client: Any) -> None:
        logger.info(f"Client connected: {client}")

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(_transport: Any, client: Any) -> None:
        logger.info(f"Client disconnected: {client}")

    # Run the server
    runner = PipelineRunner(handle_sigint=True)

    # Configure FastAPI/uvicorn server for config API
    api_port = port + 1  # Config API runs on port 8766 if WebSocket is on 8765
    uvicorn_config = uvicorn.Config(
        config_api_app,
        host=host,
        port=api_port,
        log_level="warning",  # Reduce noise from uvicorn
    )
    api_server = uvicorn.Server(uvicorn_config)

    logger.info("=" * 60)
    logger.success("Voice Dictation Server Ready!")
    logger.info("=" * 60)
    logger.info(f"WebSocket endpoint: ws://{host}:{port}")
    logger.info(f"Config API endpoint: http://{host}:{api_port}")
    logger.info("Waiting for Tauri client connection...")
    logger.info("Press Ctrl+C to stop")
    logger.info("=" * 60)

    try:
        # Run both servers concurrently
        await asyncio.gather(
            runner.run(task),
            api_server.serve(),
        )
    except asyncio.CancelledError:
        logger.info("Server stopped")
    except Exception as e:
        logger.error(f"Server error: {e}")
        raise


@app.command()
def main(
    host: str = typer.Option(
        "127.0.0.1",
        "--host",
        "-h",
        help="Host to bind to",
    ),
    port: int = typer.Option(
        8765,
        "--port",
        "-p",
        help="Port to listen on",
    ),
    verbose: bool = typer.Option(
        False,
        "--verbose",
        "-v",
        help="Enable verbose logging",
    ),
) -> None:
    """Start the voice dictation WebSocket server.

    Examples:
        dictation-server
        dictation-server --port 9000
        dictation-server --host 0.0.0.0 --port 8765
    """
    # Configure logging
    configure_logging()

    if verbose:
        logger.info("Verbose logging enabled")

    # Load settings
    try:
        settings = Settings()
    except Exception as e:
        logger.error(f"Configuration error: {e}")
        logger.warning("Please check your .env file and ensure all required API keys are set.")
        logger.info("See .env.example for reference.")
        raise typer.Exit(1) from e

    # Run server
    try:
        asyncio.run(run_server(host, port, settings))
    except KeyboardInterrupt:
        logger.info("Server stopped by user")


if __name__ == "__main__":
    app()
