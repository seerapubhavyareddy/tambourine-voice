import { Loader, Select } from "@mantine/core";
import {
	useAvailableProviders,
	useCurrentProviders,
	useSetServerLLMProvider,
	useSetServerSTTProvider,
	useSettings,
	useUpdateLLMProvider,
	useUpdateSTTProvider,
} from "../../lib/queries";

export function ProvidersSettings() {
	const { data: settings } = useSettings();
	const { data: availableProviders, isLoading: isLoadingProviders } =
		useAvailableProviders();
	const { data: currentProviders } = useCurrentProviders();
	const updateSTTProvider = useUpdateSTTProvider();
	const updateLLMProvider = useUpdateLLMProvider();
	const setServerSTTProvider = useSetServerSTTProvider();
	const setServerLLMProvider = useSetServerLLMProvider();

	const handleSTTProviderChange = (value: string | null) => {
		if (!value) return;
		updateSTTProvider.mutate(value, {
			onSuccess: () => {
				setServerSTTProvider.mutate(value);
			},
		});
	};

	const handleLLMProviderChange = (value: string | null) => {
		if (!value) return;
		updateLLMProvider.mutate(value, {
			onSuccess: () => {
				setServerLLMProvider.mutate(value);
			},
		});
	};

	const sttProviderOptions =
		availableProviders?.stt.map((p) => ({
			value: p.value,
			label: p.label,
		})) ?? [];

	const llmProviderOptions =
		availableProviders?.llm.map((p) => ({
			value: p.value,
			label: p.label,
		})) ?? [];

	return (
		<div className="settings-section animate-in animate-in-delay-1">
			<h3 className="settings-section-title">Providers</h3>
			<div className="settings-card">
				<div className="settings-row">
					<div>
						<p className="settings-label">Speech-to-Text</p>
						<p className="settings-description">
							Service for transcribing audio
						</p>
					</div>
					{isLoadingProviders ? (
						<Loader size="sm" color="gray" />
					) : (
						<Select
							data={sttProviderOptions}
							value={currentProviders?.stt ?? settings?.stt_provider ?? null}
							onChange={handleSTTProviderChange}
							placeholder="Select provider"
							disabled={sttProviderOptions.length === 0}
							styles={{
								input: {
									backgroundColor: "var(--bg-elevated)",
									borderColor: "var(--border-default)",
									color: "var(--text-primary)",
								},
							}}
						/>
					)}
				</div>
				<div className="settings-row" style={{ marginTop: 16 }}>
					<div>
						<p className="settings-label">Language Model</p>
						<p className="settings-description">AI service for text cleanup</p>
					</div>
					{isLoadingProviders ? (
						<Loader size="sm" color="gray" />
					) : (
						<Select
							data={llmProviderOptions}
							value={currentProviders?.llm ?? settings?.llm_provider ?? null}
							onChange={handleLLMProviderChange}
							placeholder="Select provider"
							disabled={llmProviderOptions.length === 0}
							styles={{
								input: {
									backgroundColor: "var(--bg-elevated)",
									borderColor: "var(--border-default)",
									color: "var(--text-primary)",
								},
							}}
						/>
					)}
				</div>
			</div>
		</div>
	);
}
