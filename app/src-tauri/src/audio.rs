use rodio::source::Source;
use rodio::OutputStreamBuilder;
use std::thread;
use std::time::Duration;

/// Types of sounds that can be played
#[derive(Debug, Clone, Copy)]
pub enum SoundType {
    RecordingStart,
    RecordingStop,
}

/// Play a sound effect (non-blocking)
pub fn play_sound(sound_type: SoundType) {
    // Spawn a thread to play sound without blocking
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

    let duration_ms = match sound_type {
        SoundType::RecordingStart => 150,
        SoundType::RecordingStop => 200,
    };

    let source = TambourineSound::new(sound_type)
        .take_duration(Duration::from_millis(duration_ms))
        .amplify(0.3);

    stream.mixer().add(source);
    thread::sleep(Duration::from_millis(duration_ms + 50));

    Ok(())
}

/// BiQuad resonant filter for modeling tambourine jingle resonances
/// Uses the standard Direct Form 1 implementation
struct BiQuadFilter {
    // Coefficients
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    // State
    x1: f32,
    x2: f32,
    y1: f32,
    y2: f32,
}

impl BiQuadFilter {
    /// Create a resonant bandpass filter at the given frequency
    /// radius controls the resonance (0.99+ for metallic ring)
    fn new_resonant(frequency: f32, radius: f32, sample_rate: f32) -> Self {
        let omega = 2.0 * std::f32::consts::PI * frequency / sample_rate;

        // Resonant filter coefficients
        // y[n] = b0*x[n] + b1*x[n-1] + b2*x[n-2] - a1*y[n-1] - a2*y[n-2]
        let a1 = -2.0 * radius * omega.cos();
        let a2 = radius * radius;

        // Bandpass configuration - emphasize the resonant frequency
        let b0 = 1.0 - radius;
        let b1 = 0.0;
        let b2 = -(1.0 - radius);

        Self {
            b0,
            b1,
            b2,
            a1,
            a2,
            x1: 0.0,
            x2: 0.0,
            y1: 0.0,
            y2: 0.0,
        }
    }

    fn process(&mut self, input: f32) -> f32 {
        let output = self.b0 * input + self.b1 * self.x1 + self.b2 * self.x2
            - self.a1 * self.y1
            - self.a2 * self.y2;

        // Update state
        self.x2 = self.x1;
        self.x1 = input;
        self.y2 = self.y1;
        self.y1 = output;

        output
    }
}

/// PhISEM-based tambourine sound synthesis
/// Models multiple jingle collisions filtered through resonant frequencies
struct TambourineSound {
    sample_rate: u32,
    sample_index: u64,
    /// LFSR for noise generation
    noise_state: u32,
    /// Resonant filters for the three main tambourine frequencies
    filters: Vec<BiQuadFilter>,
    /// Filter gains (different emphasis for each resonance)
    filter_gains: Vec<f32>,
    /// Number of simulated jingles
    num_objects: u32,
    /// System energy (decays over time)
    system_energy: f32,
    /// Energy decay rate per sample
    system_decay: f32,
    /// Collision probability threshold
    collision_threshold: f32,
    /// Second LFSR for collision randomness
    collision_state: u32,
    /// Whether this is the start sound (brighter) or stop sound
    is_start_sound: bool,
}

impl TambourineSound {
    fn new(sound_type: SoundType) -> Self {
        let sample_rate = 44100u32;
        let is_start_sound = matches!(sound_type, SoundType::RecordingStart);

        // PhISEM tambourine resonant frequencies (from Csound/STK research)
        // Main: 2300 Hz, Second: 5600 Hz, Third: 8100 Hz
        let (frequencies, radii) = if is_start_sound {
            // Brighter, more energetic for start
            (
                vec![2300.0, 5600.0, 8100.0],
                vec![0.996, 0.995, 0.994], // High resonance for metallic ring
            )
        } else {
            // Slightly warmer for stop
            (vec![2100.0, 5200.0, 7500.0], vec![0.995, 0.994, 0.993])
        };

        let filters: Vec<BiQuadFilter> = frequencies
            .iter()
            .zip(radii.iter())
            .map(|(&freq, &radius)| BiQuadFilter::new_resonant(freq, radius, sample_rate as f32))
            .collect();

        // Different gains for each resonance (emphasize mid frequencies)
        let filter_gains = vec![1.0, 0.7, 0.4];

        // PhISEM parameters
        let num_objects = if is_start_sound { 32 } else { 24 }; // Number of jingles
        let system_energy = if is_start_sound { 1.0 } else { 0.8 };
        let system_decay = 0.9995; // Energy decay per sample

        // Collision threshold - lower = more collisions
        let collision_threshold = 1.0 / num_objects as f32;

        Self {
            sample_rate,
            sample_index: 0,
            noise_state: 0xACE1u32,
            filters,
            filter_gains,
            num_objects,
            system_energy,
            system_decay,
            collision_threshold,
            collision_state: 0x1234u32,
            is_start_sound,
        }
    }

    /// Generate white noise using LFSR
    fn next_noise(&mut self) -> f32 {
        let bit = (self.noise_state
            ^ (self.noise_state >> 2)
            ^ (self.noise_state >> 3)
            ^ (self.noise_state >> 5))
            & 1;
        self.noise_state = (self.noise_state >> 1) | (bit << 15);
        (self.noise_state as f32 / 32768.0) - 1.0
    }

    /// Generate random value for collision detection
    fn next_random(&mut self) -> f32 {
        // Different LFSR for collision randomness
        let bit = (self.collision_state
            ^ (self.collision_state >> 1)
            ^ (self.collision_state >> 3)
            ^ (self.collision_state >> 12))
            & 1;
        self.collision_state = (self.collision_state >> 1) | (bit << 15);
        self.collision_state as f32 / 65536.0
    }

    /// Check if a collision occurs this sample (Poisson-like process)
    fn check_collision(&mut self) -> bool {
        let random = self.next_random();
        // Probability increases with energy and number of objects
        let probability =
            self.collision_threshold * self.system_energy * self.num_objects as f32 * 0.5;
        random < probability
    }
}

impl Iterator for TambourineSound {
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        // Decay system energy over time
        self.system_energy *= self.system_decay;

        // Generate excitation signal
        let mut excitation = 0.0f32;

        // PhISEM: Check for collisions and generate noise bursts
        if self.check_collision() {
            // Collision occurred - generate a noise burst
            // The burst amplitude is proportional to system energy
            excitation = self.next_noise() * self.system_energy * 1.5;
        }

        // Also add some continuous low-level noise for shimmer
        excitation += self.next_noise() * self.system_energy * 0.1;

        // Filter the excitation through all resonant filters and sum
        let mut output = 0.0f32;
        for (filter, &gain) in self.filters.iter_mut().zip(self.filter_gains.iter()) {
            output += filter.process(excitation) * gain;
        }

        // Apply overall envelope - fast attack, natural decay
        let time = self.sample_index as f32 / self.sample_rate as f32;
        let attack_time = 0.003; // 3ms attack
        let attack_env = if time < attack_time {
            time / attack_time
        } else {
            1.0
        };

        // Additional amplitude envelope for shaping
        let duration = if self.is_start_sound { 0.15 } else { 0.20 };
        let decay_env = (-time / duration * 2.5).exp();

        let sample = output * attack_env * decay_env;

        // Soft clip to prevent harsh distortion
        let sample = sample.tanh();

        self.sample_index = self.sample_index.wrapping_add(1);
        Some(sample)
    }
}

impl Source for TambourineSound {
    fn current_span_len(&self) -> Option<usize> {
        None
    }

    fn channels(&self) -> u16 {
        1
    }

    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    fn total_duration(&self) -> Option<Duration> {
        None
    }
}
