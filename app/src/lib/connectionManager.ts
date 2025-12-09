import type { PipecatClient } from "@pipecat-ai/client-js";
import { Data, Duration, Effect, Schedule } from "effect";

/**
 * Tagged error type for connection failures.
 * Using Effect's Data.TaggedError for type-safe error handling.
 */
class ConnectionError extends Data.TaggedError("ConnectionError")<{
	cause: unknown;
	attemptNumber: number;
}> {}

/**
 * Callbacks for connection state changes.
 * These bridge Effect back to React/Zustand state management.
 */
interface ConnectionCallbacks {
	onConnecting: () => void;
	onConnected: () => void;
	onDisconnected: () => void;
	onRetryScheduled: (attemptNumber: number, delayMs: number) => void;
	onRetryFailed: (error: ConnectionError) => void;
}

const MAX_DELAY = Duration.seconds(30);

/**
 * Retry schedule: exponential backoff with jitter, capped at 30 seconds.
 * 1s -> 2s -> 4s -> 8s -> 16s -> 30s (max)
 */
const createRetrySchedule = () =>
	Schedule.exponential("1 second").pipe(
		Schedule.jittered,
		Schedule.whileOutput((duration) =>
			Duration.lessThanOrEqualTo(duration, MAX_DELAY),
		),
		Schedule.compose(Schedule.forever),
	);

/**
 * Create an Effect that attempts to connect to the Pipecat server.
 * This Effect will retry indefinitely with exponential backoff on failure.
 *
 * @param client - The PipecatClient instance
 * @param serverUrl - WebSocket URL to connect to
 * @param callbacks - Callbacks for state changes
 */
const makeConnectEffect = (
	client: PipecatClient,
	serverUrl: string,
	callbacks: ConnectionCallbacks,
) => {
	let attemptNumber = 0;

	const connectOnce = Effect.gen(function* () {
		attemptNumber++;
		yield* Effect.sync(() => callbacks.onConnecting());

		yield* Effect.tryPromise({
			try: () => client.connect({ wsUrl: serverUrl }),
			catch: (e) => new ConnectionError({ cause: e, attemptNumber }),
		});
	});

	return connectOnce.pipe(
		Effect.retry(
			createRetrySchedule().pipe(
				Schedule.tapOutput((duration) =>
					Effect.sync(() => {
						// Convert Duration to milliseconds for callback
						const delayMs = Duration.toMillis(duration);
						callbacks.onRetryScheduled(attemptNumber, delayMs);
					}),
				),
			),
		),
		Effect.tapError((error) =>
			Effect.sync(() => callbacks.onRetryFailed(error)),
		),
	);
};

/**
 * Connection manager that handles the connection lifecycle with Effect.
 * Provides methods to start, stop, and check connection status.
 */
export interface ConnectionManager {
	/** Start the connection with retry logic */
	start: () => void;
	/** Stop the connection and cancel any pending retries */
	stop: () => void;
	/** Check if currently attempting to connect */
	isConnecting: () => boolean;
}

/**
 * Create a connection manager instance.
 * This bridges Effect's fiber-based execution to imperative React code.
 *
 * @param client - The PipecatClient instance
 * @param serverUrl - WebSocket URL to connect to
 * @param callbacks - Callbacks for state changes
 */
export function createConnectionManager(
	client: PipecatClient,
	serverUrl: string,
	callbacks: ConnectionCallbacks,
): ConnectionManager {
	let abortController: AbortController | null = null;
	let connecting = false;

	return {
		start: () => {
			if (connecting) return;
			connecting = true;

			// Create abort controller for cancellation
			abortController = new AbortController();
			const signal = abortController.signal;

			const effect = makeConnectEffect(client, serverUrl, callbacks);

			// Run the effect and handle completion/cancellation
			Effect.runPromise(effect, { signal })
				.then(() => {
					connecting = false;
					// Note: onConnected is called by Pipecat's RTVIEvent.Connected,
					// not here, to ensure proper sequencing with settings sync
				})
				.catch((error) => {
					connecting = false;
					if (error.name !== "AbortError") {
						console.error("[ConnectionManager] Unexpected error:", error);
					}
				});
		},

		stop: () => {
			if (abortController) {
				abortController.abort();
				abortController = null;
			}
			connecting = false;
		},

		isConnecting: () => connecting,
	};
}
