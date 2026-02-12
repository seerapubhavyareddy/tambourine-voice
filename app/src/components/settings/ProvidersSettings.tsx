import { Badge, Loader, Select, Slider, Text } from "@mantine/core";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	useAvailableProviders,
	useSettings,
	useUpdateLLMProviderWithServer,
	useUpdateSTTProviderWithServer,
	useUpdateSTTTimeout,
} from "../../lib/queries";
import type { ProviderInfo } from "../../lib/tauri";
import { useRecordingStore } from "../../stores/recordingStore";
import { StatusIndicator } from "./StatusIndicator";

// Match server's DEFAULT_TRANSCRIPTION_WAIT_TIMEOUT_SECONDS
const DEFAULT_STT_TIMEOUT = 0.5;

const selectInputStyles = {
	input: {
		backgroundColor: "var(--bg-elevated)",
		borderColor: "var(--border-default)",
		color: "var(--text-primary)",
	},
} as const;

/** Select option format for Mantine Select */
interface SelectOption {
	value: string;
	label: string;
}

/** Grouped select options format for Mantine Select */
interface GroupedSelectOptions {
	group: string;
	items: SelectOption[];
}

function normalizeProviderValue(value: string | null | undefined): string | null {
	if (typeof value !== "string") return null;
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : null;
}

function resolveProviderDisplayValue(
	candidateValue: string | null | undefined,
	availableProviderValues: Set<string>,
): string {
	const normalizedCandidate = normalizeProviderValue(candidateValue);

	if (!normalizedCandidate || normalizedCandidate === "auto") {
		return "auto";
	}

	return availableProviderValues.has(normalizedCandidate)
		? normalizedCandidate
		: "auto";
}

/**
 * Group providers by cloud/local for dropdown display.
 * Returns grouped options with "Auto" at the top, followed by "Cloud" and "Local" groups.
 */
function groupProvidersByType(
	providers: ProviderInfo[] | undefined,
): GroupedSelectOptions[] {
	if (!providers) {
		return [{ group: "", items: [{ value: "auto", label: "Auto" }] }];
	}

	const toSelectOption = (provider: ProviderInfo): SelectOption => ({
		value: provider.value,
		label: provider.model
			? `${provider.label} (${provider.model})`
			: provider.label,
	});

	const cloudProviders = providers
		.filter((p) => !p.is_local)
		.map(toSelectOption);
	const localProviders = providers
		.filter((p) => p.is_local)
		.map(toSelectOption);

	return [
		{ group: "", items: [{ value: "auto", label: "Auto" }] },
		{ group: "Cloud", items: cloudProviders },
		{ group: "Local", items: localProviders },
	];
}

function ProviderBadge({ isLocal }: { isLocal: boolean }) {
	return (
		<Badge size="xs" variant="light" color={isLocal ? "teal" : "blue"}>
			{isLocal ? "Local" : "Cloud"}
		</Badge>
	);
}

export function ProvidersSettings() {
	const { data: settings, isLoading: isLoadingSettings } = useSettings();
	const { data: availableProviders, isLoading: isLoadingProviders } =
		useAvailableProviders();
	const connectionState = useRecordingStore((s) => s.state);

	// Wait for settings (source of truth) and provider list (for options)
	const isLoadingProviderData = isLoadingSettings || isLoadingProviders;
	const canSendProviderRequests =
		connectionState === "idle" ||
		connectionState === "startingRecording" ||
		connectionState === "recording" ||
		connectionState === "processing";
	const sttTimeoutMutation = useUpdateSTTTimeout();

	// Provider mutations handle pessimistic updates automatically:
	// - isPending: show spinner while waiting for server confirmation
	// - isSuccess: show checkmark when server confirms
	// - isError: show X if server rejects or times out
	// - variables: the value user selected (for display during pending state)
	const sttMutation = useUpdateSTTProviderWithServer();
	const llmMutation = useUpdateLLMProviderWithServer();

	// AbortControllers for cleanup on unmount
	const sttAbortControllerRef = useRef<AbortController | null>(null);
	const llmAbortControllerRef = useRef<AbortController | null>(null);

	useEffect(() => {
		return () => {
			// Clean up any pending mutations on unmount
			sttAbortControllerRef.current?.abort();
			llmAbortControllerRef.current?.abort();
		};
	}, []);

	const handleSTTProviderChange = (value: string | null) => {
		if (!value || sttMutation.isPending || !canSendProviderRequests) return;
		sttAbortControllerRef.current = new AbortController();
		sttMutation.mutate({ value, signal: sttAbortControllerRef.current.signal });
	};

	const handleLLMProviderChange = (value: string | null) => {
		if (!value || llmMutation.isPending || !canSendProviderRequests) return;
		llmAbortControllerRef.current = new AbortController();
		llmMutation.mutate({ value, signal: llmAbortControllerRef.current.signal });
	};

	const handleSTTTimeoutChange = (value: number) => {
		sttTimeoutMutation.mutate(value);
	};

	// Get the current timeout value from settings, falling back to default
	const currentTimeout = settings?.stt_timeout_seconds ?? DEFAULT_STT_TIMEOUT;

	// Local state for smooth slider dragging
	const [sliderValue, setSliderValue] = useState(currentTimeout);

	// Sync local state when server value changes
	useEffect(() => {
		setSliderValue(currentTimeout);
	}, [currentTimeout]);

	// Group providers by cloud/local for dropdown display (memoized to prevent unnecessary re-renders)
	const sttProviderOptions = useMemo(
		() => groupProvidersByType(availableProviders?.stt),
		[availableProviders],
	);
	const llmProviderOptions = useMemo(
		() => groupProvidersByType(availableProviders?.llm),
		[availableProviders],
	);

	const availableSttProviderValues = useMemo(
		() => new Set((availableProviders?.stt ?? []).map((provider) => provider.value)),
		[availableProviders],
	);
	const availableLlmProviderValues = useMemo(
		() => new Set((availableProviders?.llm ?? []).map((provider) => provider.value)),
		[availableProviders],
	);

	// Get candidate value for dropdown:
	// - During mutation: show what user selected (mutation.variables.value)
	// - Otherwise: show confirmed value from store
	const sttCandidateValue = sttMutation.isPending
		? sttMutation.variables?.value
		: (settings?.stt_provider ?? "auto");
	const llmCandidateValue = llmMutation.isPending
		? llmMutation.variables?.value
		: (settings?.llm_provider ?? "auto");
	const normalizedSavedSttProvider = normalizeProviderValue(settings?.stt_provider);
	const normalizedSavedLlmProvider = normalizeProviderValue(settings?.llm_provider);

	// Fallback to "auto" when persisted provider is missing, blank, or unavailable on server.
	const sttDisplayValue = resolveProviderDisplayValue(
		sttCandidateValue,
		availableSttProviderValues,
	);
	const llmDisplayValue = resolveProviderDisplayValue(
		llmCandidateValue,
		availableLlmProviderValues,
	);

	// Determine if currently selected provider is local (only show badge for non-auto providers)
	const selectedSttProvider = availableProviders?.stt.find(
		(p) => p.value === sttDisplayValue,
	);
	const selectedLlmProvider = availableProviders?.llm.find(
		(p) => p.value === llmDisplayValue,
	);
	const isSttProviderAuto = sttDisplayValue === "auto";
	const isLlmProviderAuto = llmDisplayValue === "auto";
	const isSttProviderLocal = selectedSttProvider?.is_local ?? false;
	const isLlmProviderLocal = selectedLlmProvider?.is_local ?? false;

	// Remember last invalid value attempted to auto-heal, to avoid repeated retries.
	const lastAutoHealAttemptRef = useRef<{ stt: string | null; llm: string | null }>(
		{
			stt: null,
			llm: null,
		},
	);

	useEffect(() => {
		if (
			!canSendProviderRequests ||
			!settings ||
			!availableProviders?.stt ||
			sttMutation.isPending
		) {
			return;
		}

		const hasValidSavedProvider =
			normalizedSavedSttProvider != null &&
			(normalizedSavedSttProvider === "auto" ||
				availableSttProviderValues.has(normalizedSavedSttProvider));
		if (hasValidSavedProvider) {
			lastAutoHealAttemptRef.current.stt = null;
			return;
		}

		const attemptKey = normalizedSavedSttProvider ?? "__unset__";
		if (lastAutoHealAttemptRef.current.stt === attemptKey) return;
		lastAutoHealAttemptRef.current.stt = attemptKey;

		sttAbortControllerRef.current = new AbortController();
		sttMutation.mutate({
			value: "auto",
			signal: sttAbortControllerRef.current.signal,
		});
	}, [
		canSendProviderRequests,
		settings,
		availableProviders,
		sttMutation,
		normalizedSavedSttProvider,
		availableSttProviderValues,
	]);

	useEffect(() => {
		if (
			!canSendProviderRequests ||
			!settings ||
			!availableProviders?.llm ||
			llmMutation.isPending
		) {
			return;
		}

		const hasValidSavedProvider =
			normalizedSavedLlmProvider != null &&
			(normalizedSavedLlmProvider === "auto" ||
				availableLlmProviderValues.has(normalizedSavedLlmProvider));
		if (hasValidSavedProvider) {
			lastAutoHealAttemptRef.current.llm = null;
			return;
		}

		const attemptKey = normalizedSavedLlmProvider ?? "__unset__";
		if (lastAutoHealAttemptRef.current.llm === attemptKey) return;
		lastAutoHealAttemptRef.current.llm = attemptKey;

		llmAbortControllerRef.current = new AbortController();
		llmMutation.mutate({
			value: "auto",
			signal: llmAbortControllerRef.current.signal,
		});
	}, [
		canSendProviderRequests,
		settings,
		availableProviders,
		llmMutation,
		normalizedSavedLlmProvider,
		availableLlmProviderValues,
	]);

	return (
		<div className="settings-section animate-in animate-in-delay-1">
			<h3 className="settings-section-title">Providers</h3>
			<div className="settings-card">
				<div className="settings-row">
					<div>
						<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
							<p className="settings-label">Speech-to-Text (STT)</p>
							<StatusIndicator status={sttMutation.status} />
						</div>
						<p className="settings-description">
							Service for transcribing audio
						</p>
					</div>
					{isLoadingProviderData ? (
						<Loader size="sm" color="gray" />
					) : (
						<Select
							data={sttProviderOptions}
							value={sttDisplayValue}
							onChange={handleSTTProviderChange}
							placeholder="Select provider"
							disabled={
								sttMutation.isPending || !availableProviders?.stt.length
							}
							rightSection={
								!isSttProviderAuto && settings?.stt_provider ? (
									<ProviderBadge isLocal={isSttProviderLocal} />
								) : undefined
							}
							rightSectionWidth={60}
							styles={selectInputStyles}
						/>
					)}
				</div>
				<div className="settings-row" style={{ marginTop: 16 }}>
					<div>
						<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
							<p className="settings-label">Large Language Model (LLM)</p>
							<StatusIndicator status={llmMutation.status} />
						</div>
						<p className="settings-description">Service for text formatting</p>
					</div>
					{isLoadingProviderData ? (
						<Loader size="sm" color="gray" />
					) : (
						<Select
							data={llmProviderOptions}
							value={llmDisplayValue}
							onChange={handleLLMProviderChange}
							placeholder="Select provider"
							disabled={
								llmMutation.isPending || !availableProviders?.llm.length
							}
							rightSection={
								!isLlmProviderAuto && settings?.llm_provider ? (
									<ProviderBadge isLocal={isLlmProviderLocal} />
								) : undefined
							}
							rightSectionWidth={60}
							styles={selectInputStyles}
						/>
					)}
				</div>
				<div className="settings-row" style={{ marginTop: 16 }}>
					<div style={{ flex: 1 }}>
						<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
							<p className="settings-label">STT Timeout</p>
							<StatusIndicator status={sttTimeoutMutation.status} />
						</div>
						<p className="settings-description">
							Increase if nothing is getting transcribed
						</p>
						<div
							style={{
								marginTop: 12,
								display: "flex",
								alignItems: "center",
								gap: 12,
							}}
						>
							<Slider
								value={sliderValue}
								onChange={setSliderValue}
								onChangeEnd={handleSTTTimeoutChange}
								min={0.5}
								max={3.0}
								step={0.1}
								disabled={sttTimeoutMutation.isPending}
								marks={[
									{ value: 0.5, label: "0.5s" },
									{ value: 3.0, label: "3.0s" },
								]}
								styles={{
									root: { flex: 1 },
									track: { backgroundColor: "var(--bg-elevated)" },
									bar: { backgroundColor: "var(--accent-primary)" },
									thumb: { borderColor: "var(--accent-primary)" },
									markLabel: { color: "var(--text-secondary)", fontSize: 10 },
								}}
							/>
							<Text size="xs" c="dimmed" style={{ minWidth: 32 }}>
								{sliderValue.toFixed(1)}s
							</Text>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
