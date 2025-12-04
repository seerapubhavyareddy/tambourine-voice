"""FastAPI configuration server for voice dictation settings."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from processors.llm_cleanup import CLEANUP_SYSTEM_PROMPT

if TYPE_CHECKING:
    from processors.llm_cleanup import TranscriptionToLLMConverter

app = FastAPI(title="Voice Dictation Config API")

# CORS for Tauri frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Shared state - will be set by main server
_llm_converter: TranscriptionToLLMConverter | None = None


def set_llm_converter(converter: TranscriptionToLLMConverter) -> None:
    """Set the LLM converter reference for runtime prompt updates.

    Args:
        converter: The TranscriptionToLLMConverter instance from the pipeline.
    """
    global _llm_converter
    _llm_converter = converter


class PromptUpdate(BaseModel):
    """Request body for updating the cleanup prompt."""

    prompt: str | None


class DefaultPromptResponse(BaseModel):
    """Response for the default prompt endpoint."""

    prompt: str


class CurrentPromptResponse(BaseModel):
    """Response for the current prompt endpoint."""

    prompt: str
    is_custom: bool


class SetPromptResponse(BaseModel):
    """Response for setting the prompt."""

    success: bool
    error: str | None = None


@app.get("/api/prompt/default", response_model=DefaultPromptResponse)
async def get_default_prompt() -> DefaultPromptResponse:
    """Get the built-in default cleanup prompt."""
    return DefaultPromptResponse(prompt=CLEANUP_SYSTEM_PROMPT)


@app.get("/api/prompt/current", response_model=CurrentPromptResponse)
async def get_current_prompt() -> CurrentPromptResponse:
    """Get the currently active cleanup prompt (custom or default)."""
    if _llm_converter:
        return CurrentPromptResponse(
            prompt=_llm_converter.system_prompt,
            is_custom=_llm_converter._custom_prompt is not None,
        )
    return CurrentPromptResponse(prompt=CLEANUP_SYSTEM_PROMPT, is_custom=False)


@app.post("/api/prompt", response_model=SetPromptResponse)
async def set_prompt(data: PromptUpdate) -> SetPromptResponse:
    """Set a custom cleanup prompt or reset to default.

    Args:
        data: The prompt update request. Set prompt to null to reset to default.
    """
    if _llm_converter:
        _llm_converter.set_custom_prompt(data.prompt)
        return SetPromptResponse(success=True)
    return SetPromptResponse(success=False, error="LLM converter not initialized")
