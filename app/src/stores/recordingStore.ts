import type { PipecatClient } from "@pipecat-ai/client-js";
import { create } from "zustand";

/**
 * Explicit state machine for connection and recording states.
 * Prevents invalid state combinations (e.g., recording while disconnected).
 */
type ConnectionState =
	| "disconnected" // Not connected to server
	| "connecting" // Connection in progress
	| "idle" // Connected, ready to record
	| "recording" // Mic enabled, streaming audio
	| "processing"; // Waiting for server response

/** Information about the current retry attempt */
export interface RetryInfo {
	attemptNumber: number;
	nextRetryMs: number;
}

interface RecordingState {
	state: ConnectionState;
	client: PipecatClient | null;
	serverUrl: string | null;
	/** Information about current retry attempt (null if not retrying) */
	retryInfo: RetryInfo | null;

	// Actions
	setClient: (client: PipecatClient | null) => void;
	setServerUrl: (url: string | null) => void;
	setState: (state: ConnectionState) => void;
	setRetryInfo: (info: RetryInfo | null) => void;

	// State transitions
	startConnecting: () => void;
	handleConnected: () => void;
	handleDisconnected: () => void;
	startRecording: () => Promise<boolean>; // Returns false if not in valid state
	stopRecording: () => boolean; // Returns false if not in valid state
	handleResponse: () => void;
	reset: () => void;
}

export const useRecordingStore = create<RecordingState>((set, get) => ({
	state: "disconnected",
	client: null,
	serverUrl: null,
	retryInfo: null,

	setClient: (client) => set({ client }),
	setServerUrl: (serverUrl) => set({ serverUrl }),
	setState: (state) => set({ state }),
	setRetryInfo: (retryInfo) => set({ retryInfo }),

	startConnecting: () => {
		const currentState = get().state;
		if (currentState === "disconnected") {
			set({ state: "connecting" });
		}
	},

	handleConnected: () => {
		const currentState = get().state;
		if (currentState === "connecting" || currentState === "disconnected") {
			set({ state: "idle", retryInfo: null });
		}
	},

	handleDisconnected: () => {
		set({ state: "disconnected" });
	},

	startRecording: async () => {
		const { state, client } = get();
		console.log(
			"[Store] startRecording called, state:",
			state,
			"client:",
			!!client,
		);
		if (state !== "idle" || !client) {
			console.log("[Store] startRecording rejected - wrong state or no client");
			return false;
		}

		// Signal server to reset buffer and enable mic
		try {
			console.log(
				"[Store] Sending start-recording message and enabling mic...",
			);
			client.sendClientMessage("start-recording", {});

			// Re-acquire mic track if it was stopped (uses replaceTrack internally)
			const selectedMic = client.selectedMic;
			if (selectedMic) {
				console.log("[Store] Re-acquiring mic via updateMic...");
				await client.updateMic(selectedMic.deviceId);
			}

			client.enableMic(true);
			console.log("[Store] Mic enabled, transitioning to recording state");
			set({ state: "recording" });
			return true;
		} catch (error) {
			console.error("[Store] Error starting recording:", error);
			return false;
		}
	},

	stopRecording: () => {
		const { state, client } = get();
		console.log(
			"[Store] stopRecording called, state:",
			state,
			"client:",
			!!client,
		);
		if (state !== "recording" || !client) {
			console.log("[Store] stopRecording rejected - wrong state or no client");
			return false;
		}

		// Disable mic first
		console.log("[Store] Disabling mic...");
		try {
			client.enableMic(false);
		} catch (error) {
			console.warn("[Store] Failed to disable mic:", error);
		}

		// Try to send stop message to server
		try {
			client.sendClientMessage("stop-recording", {});
			console.log("[Store] Transitioning to processing state");
			set({ state: "processing" });
			return true;
		} catch (error) {
			console.warn("[Store] Failed to send stop-recording message:", error);
			set({ state: "disconnected" });
			return true;
		}
	},

	handleResponse: () => {
		const { state, client } = get();
		if (state === "processing") {
			// Stop the audio track to release the microphone (removes OS mic indicator)
			// updateMic() will re-acquire when starting next recording
			if (client) {
				try {
					const tracks = client.tracks();
					if (tracks?.local?.audio) {
						console.log("[Store] Stopping audio track to release microphone");
						tracks.local.audio.stop();
					}
				} catch (error) {
					console.warn("[Store] Failed to stop audio track:", error);
				}
			}
			set({ state: "idle" });
		}
	},

	reset: () => set({ state: "disconnected", client: null, retryInfo: null }),
}));
