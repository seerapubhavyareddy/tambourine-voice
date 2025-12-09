use rodio::source::Source;
use rodio::{Decoder, OutputStreamBuilder};
use std::io::Cursor;
use std::thread;
use std::time::Duration;

/// Types of sounds that can be played
#[derive(Debug, Clone, Copy)]
pub enum SoundType {
    RecordingStart,
    RecordingStop,
}

// Embed audio files at compile time
const START_SOUND: &[u8] = include_bytes!("assets/start.mp3");
const STOP_SOUND: &[u8] = include_bytes!("assets/stop.mp3");

/// Play a sound effect (non-blocking)
pub fn play_sound(sound_type: SoundType) {
    thread::spawn(move || {
        if let Err(e) = play_sound_blocking(sound_type) {
            log::warn!("Failed to play sound: {}", e);
        }
    });
}

fn play_sound_blocking(
    sound_type: SoundType,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let stream = OutputStreamBuilder::open_default_stream()?;

    let sound_data = match sound_type {
        SoundType::RecordingStart => START_SOUND,
        SoundType::RecordingStop => STOP_SOUND,
    };

    let cursor = Cursor::new(sound_data);
    let source = Decoder::new(cursor)?.amplify(0.3);

    // Get duration for sleep, default to 500ms if unknown
    let duration = source
        .total_duration()
        .unwrap_or(Duration::from_millis(500));

    stream.mixer().add(source);
    thread::sleep(duration + Duration::from_millis(50));

    Ok(())
}
