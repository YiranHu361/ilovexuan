# I Love Xuan - Birthday Gift

Interactive 3D Particle System for Chrome/Edge.

## Features
- **Hand Gesture Control**: Use your webcam.
  - **Open Palm**: Particles disperse into floating image pieces.
  - **Closed Fist**: Particles assemble into the selected 3D shape.
- **Shapes**: Heart, Flower, Star, Planet, Buddha, Fireworks.
- **Controls**: Shape selector, Color picker, Fullscreen.

## How to Run

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Start Dev Server**:
   ```bash
   npm run dev
   ```

3. **Open Browser**:
   Navigate to the URL shown (usually `http://localhost:5173`).
   Allow Camera access when prompted.

## Customization
- Replace the placeholder texture generation in `src/particleSystem.js` (`createPlaceholderTexture`) with actual image loading if desired.

