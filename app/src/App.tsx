import { Kbd, Loader, NavLink, Text, Title, Tooltip } from "@mantine/core";
import { Home, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { HistoryFeed } from "./components/HistoryFeed";
import { Logo } from "./components/Logo";
import {
	AudioSettings,
	HotkeySettings,
	PromptSettings,
	ProvidersSettings,
} from "./components/settings";
import { useSettings } from "./lib/queries";
import {
	type HotkeyConfig,
	type RetryStatusPayload,
	tauriAPI,
} from "./lib/tauri";
import { type RetryInfo, useRecordingStore } from "./stores/recordingStore";
import "./styles.css";

type View = "home" | "settings";

function ConnectionStatusIndicator() {
	const state = useRecordingStore((s) => s.state);
	const setState = useRecordingStore((s) => s.setState);
	const setRetryInfo = useRecordingStore((s) => s.setRetryInfo);
	const [retryInfo, setLocalRetryInfo] = useState<RetryInfo | null>(null);

	// Listen for connection state changes from the overlay window
	useEffect(() => {
		let unlistenState: (() => void) | undefined;
		let unlistenRetry: (() => void) | undefined;

		const setup = async () => {
			unlistenState = await tauriAPI.onConnectionStateChanged((newState) => {
				setState(newState);
				// Clear retry info when connected or disconnected
				if (newState === "idle" || newState === "disconnected") {
					setLocalRetryInfo(null);
					setRetryInfo(null);
				}
			});

			unlistenRetry = await tauriAPI.onRetryStatusChanged(
				(payload: RetryStatusPayload) => {
					setState(payload.state);
					setLocalRetryInfo(payload.retryInfo);
					setRetryInfo(payload.retryInfo);
				},
			);
		};

		setup();

		return () => {
			unlistenState?.();
			unlistenRetry?.();
		};
	}, [setState, setRetryInfo]);

	const isConnected =
		state === "idle" || state === "recording" || state === "processing";
	const isConnecting = state === "connecting";

	// Build status text with retry info
	let statusText: string;
	if (isConnecting) {
		if (retryInfo) {
			const seconds = Math.ceil(retryInfo.nextRetryMs / 1000);
			statusText = `Reconnecting (attempt ${retryInfo.attemptNumber}, next in ${seconds}s)`;
		} else {
			statusText = "Connecting...";
		}
	} else if (isConnected) {
		statusText = "Connected";
	} else {
		statusText = "Disconnected";
	}

	return (
		<Tooltip label={statusText} position="right" withArrow>
			<div className="connection-status">
				{isConnecting ? (
					<Loader size={10} color="gray" />
				) : (
					<span
						className={`connection-status-dot ${isConnected ? "connected" : "disconnected"}`}
					/>
				)}
			</div>
		</Tooltip>
	);
}

function Sidebar({
	activeView,
	onViewChange,
}: {
	activeView: View;
	onViewChange: (view: View) => void;
}) {
	return (
		<aside className="sidebar">
			<header className="sidebar-header">
				<div className="sidebar-logo">
					<Logo size={32} />
				</div>
			</header>

			<nav className="sidebar-nav">
				<Tooltip label="Home" position="right" withArrow>
					<NavLink
						leftSection={<Home size={20} />}
						active={activeView === "home"}
						onClick={() => onViewChange("home")}
						variant="filled"
						className="sidebar-nav-link"
					/>
				</Tooltip>
				<Tooltip label="Settings" position="right" withArrow>
					<NavLink
						leftSection={<Settings size={20} />}
						active={activeView === "settings"}
						onClick={() => onViewChange("settings")}
						variant="filled"
						className="sidebar-nav-link"
					/>
				</Tooltip>
			</nav>

			<footer className="sidebar-footer">
				<ConnectionStatusIndicator />
				<p className="sidebar-footer-text">v1.0.0</p>
			</footer>
		</aside>
	);
}

function HotkeyDisplay({ config }: { config: HotkeyConfig }) {
	const parts = [
		...config.modifiers.map((m) => m.charAt(0).toUpperCase() + m.slice(1)),
		config.key,
	];

	return (
		<span className="kbd-combo">
			{parts.map((part, index) => (
				<span key={part}>
					<Kbd>{part}</Kbd>
					{index < parts.length - 1 && <span className="kbd-plus">+</span>}
				</span>
			))}
		</span>
	);
}

function InstructionsCard() {
	const { data: settings } = useSettings();

	const toggleHotkey = settings?.toggle_hotkey ?? {
		modifiers: ["ctrl", "alt"],
		key: "Space",
	};

	const holdHotkey = settings?.hold_hotkey ?? {
		modifiers: ["ctrl", "alt"],
		key: "Period",
	};

	return (
		<div className="instructions-card animate-in">
			<h2 className="instructions-card-title">
				Dictate with your voice
			</h2>
			<div className="instructions-methods">
				<div className="instruction-method">
					<span className="instruction-label">Toggle:</span>
					<HotkeyDisplay config={toggleHotkey} />
					<span className="instruction-desc">Press to start/stop</span>
				</div>
				<div className="instruction-method">
					<span className="instruction-label">Hold:</span>
					<HotkeyDisplay config={holdHotkey} />
					<span className="instruction-desc">Hold to record</span>
				</div>
			</div>
			<p className="instructions-card-text">
				Speak clearly and your words will be typed wherever your cursor is. The
				overlay appears in the bottom-right corner of your screen.
			</p>
		</div>
	);
}

function HomeView() {
	return (
		<div className="main-content">
			<header className="animate-in" style={{ marginBottom: 32 }}>
				<Title order={1} mb={4}>
					Welcome to Tambourine
				</Title>
				<Text c="dimmed" size="sm">
					~-~-~-~-~-~
				</Text>
			</header>

			<InstructionsCard />

			<HistoryFeed />
		</div>
	);
}

function SettingsView() {
	return (
		<div className="main-content">
			<header className="animate-in" style={{ marginBottom: 32 }}>
				<Title order={1} mb={4}>
					Settings
				</Title>
				<Text c="dimmed" size="sm">
					Configure your preferences
				</Text>
			</header>

			<ProvidersSettings />
			<AudioSettings />
			<HotkeySettings />
			<PromptSettings />
		</div>
	);
}

export default function App() {
	const [activeView, setActiveView] = useState<View>("home");

	return (
		<div className="app-layout">
			<Sidebar activeView={activeView} onViewChange={setActiveView} />
			{activeView === "home" ? <HomeView /> : <SettingsView />}
		</div>
	);
}
