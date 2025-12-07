import './style.css';
import { ParticleSystem } from './particleSystem.js';
import { HandTracker } from './handTracking.js';
import { UI } from './ui.js';

async function init() {
  const canvas = document.getElementById('output_canvas');
  const videoElement = document.getElementById('input_video');
  const loading = document.getElementById('loading');

  // Init Components
  const particleSystem = new ParticleSystem(canvas);
  const ui = new UI(particleSystem);
  const handTracker = new HandTracker(videoElement);

  // Animation Loop
  let lastTime = performance.now();
  let handData = null;

  handTracker.setOnResults((data) => {
    handData = data;
    loading.style.opacity = '0'; // Hide loading once hands start working (or cameras starts)
  });

  function animate() {
    const now = performance.now();
    const dt = (now - lastTime) / 1000;
    lastTime = now;

    particleSystem.update(dt, handData);

    requestAnimationFrame(animate);
  }

  // Start
  try {
    await handTracker.start();
    animate();
  } catch (err) {
    console.error("Failed to start hand tracking:", err);
    loading.innerText = "Error accessing camera. Please allow camera access.";
  }
}

init();
