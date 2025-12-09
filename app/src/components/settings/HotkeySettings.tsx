import { Alert } from "@mantine/core";
import { AlertCircle } from "lucide-react";
import {
	useSettings,
	useUpdateHoldHotkey,
	useUpdateToggleHotkey,
} from "../../lib/queries";
import type { HotkeyConfig } from "../../lib/tauri";
import { HotkeyInput } from "../HotkeyInput";

const DEFAULT_TOGGLE_HOTKEY: HotkeyConfig = {
	modifiers: ["ctrl", "alt"],
	key: "Space",
};

const DEFAULT_HOLD_HOTKEY: HotkeyConfig = {
	modifiers: ["ctrl", "alt"],
	key: "Period",
};

export function HotkeySettings() {
	const { data: settings, isLoading } = useSettings();
	const updateToggleHotkey = useUpdateToggleHotkey();
	const updateHoldHotkey = useUpdateHoldHotkey();

	const handleToggleHotkeyChange = (config: HotkeyConfig) => {
		updateToggleHotkey.mutate(config);
	};

	const handleHoldHotkeyChange = (config: HotkeyConfig) => {
		updateHoldHotkey.mutate(config);
	};

	return (
		<div className="settings-section animate-in animate-in-delay-3">
			<h3 className="settings-section-title">Hotkeys</h3>
			<div className="settings-card">
				<HotkeyInput
					label="Toggle Recording"
					description="Press once to start recording, press again to stop"
					value={settings?.toggle_hotkey ?? DEFAULT_TOGGLE_HOTKEY}
					onChange={handleToggleHotkeyChange}
					disabled={isLoading}
				/>

				<div style={{ marginTop: 20 }}>
					<HotkeyInput
						label="Hold to Record"
						description="Hold to record, release to stop"
						value={settings?.hold_hotkey ?? DEFAULT_HOLD_HOTKEY}
						onChange={handleHoldHotkeyChange}
						disabled={isLoading}
					/>
				</div>
			</div>

			<Alert
				icon={<AlertCircle size={16} />}
				color="gray"
				variant="light"
				mt="md"
			>
				Hotkey changes require app restart to take effect.
			</Alert>
		</div>
	);
}
