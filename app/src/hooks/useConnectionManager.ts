import type { PipecatClient } from "@pipecat-ai/client-js";
import { useCallback, useEffect, useRef } from "react";
import {
	type ConnectionManager,
	createConnectionManager,
} from "../lib/connectionManager";
import { tauriAPI } from "../lib/tauri";
import { useRecordingStore } from "../stores/recordingStore";

interface UseConnectionManagerOptions {
	/** The PipecatClient instance (null if not yet created) */
	client: PipecatClient | null;
	/** WebSocket URL to connect to (null if not yet loaded) */
	serverUrl: string | null;
	/** Callback when disconnect happens during recording/processing */
	onMidRecordingDisconnect?: () => void;
}

interface UseConnectionManagerResult {
	/** Handler to call when Pipecat emits RTVIEvent.Connected */
	handlePipecatConnect: () => void;
	/** Handler to call when Pipecat emits RTVIEvent.Disconnected */
	handlePipecatDisconnect: () => void;
}

/**
 * React hook that manages the connection lifecycle using Effect-based retry logic.
 *
 * Features:
 * - Automatic connection on mount with exponential backoff retry
 * - Automatic reconnection on disconnect
 * - Graceful handling of mid-recording disconnects
 * - Clean cancellation on unmount
 * - State synchronization with Zustand store and Tauri events
 */
export function useConnectionManager({
	client,
	serverUrl,
	onMidRecordingDisconnect,
}: UseConnectionManagerOptions): UseConnectionManagerResult {
	const managerRef = useRef<ConnectionManager | null>(null);

	const { startConnecting, handleConnected, handleDisconnected, setRetryInfo } =
		useRecordingStore();

	// Create and start connection manager when client and serverUrl are ready
	useEffect(() => {
		if (!client || !serverUrl) return;

		const manager = createConnectionManager(client, serverUrl, {
			onConnecting: () => {
				console.log("[ConnectionManager] Connecting...");
				startConnecting();
			},
			onConnected: () => {
				// Note: This is called by Effect when connect() Promise resolves,
				// but we rely on Pipecat's RTVIEvent.Connected for actual connection
				// confirmation since that's when settings sync happens
				console.log("[ConnectionManager] Connect promise resolved");
			},
			onDisconnected: () => {
				console.log("[ConnectionManager] Disconnected");
				handleDisconnected();
			},
			onRetryScheduled: (attemptNumber, delayMs) => {
				console.log(
					`[ConnectionManager] Retry ${attemptNumber} scheduled in ${delayMs}ms`,
				);
				const retryInfo = { attemptNumber, nextRetryMs: delayMs };
				setRetryInfo(retryInfo);
				// Emit to main window for status display (includes retry info)
				tauriAPI.emitRetryStatus({ state: "connecting", retryInfo });
			},
			onRetryFailed: (error) => {
				console.error(
					`[ConnectionManager] Attempt ${error.attemptNumber} failed:`,
					error.cause,
				);
			},
		});

		managerRef.current = manager;
		manager.start();

		return () => {
			manager.stop();
			managerRef.current = null;
		};
	}, [client, serverUrl, startConnecting, handleDisconnected, setRetryInfo]);

	// Handler for Pipecat's Connected event
	const handlePipecatConnect = useCallback(() => {
		console.log("[ConnectionManager] Pipecat connected event received");
		// Clear retry info since we're now connected
		setRetryInfo(null);
		handleConnected();
	}, [handleConnected, setRetryInfo]);

	// Handler for Pipecat's Disconnected event
	const handlePipecatDisconnect = useCallback(() => {
		console.log("[ConnectionManager] Pipecat disconnected event received");

		// Check if we were recording/processing when disconnect happened
		const currentState = useRecordingStore.getState().state;
		if (currentState === "recording" || currentState === "processing") {
			console.warn(
				"[ConnectionManager] Disconnected during recording/processing",
			);
			onMidRecordingDisconnect?.();
		}

		handleDisconnected();

		// Trigger reconnection via the manager
		if (managerRef.current) {
			// Small delay to allow Pipecat to clean up before reconnecting
			setTimeout(() => {
				managerRef.current?.start();
			}, 100);
		}
	}, [handleDisconnected, onMidRecordingDisconnect]);

	return {
		handlePipecatConnect,
		handlePipecatDisconnect,
	};
}
