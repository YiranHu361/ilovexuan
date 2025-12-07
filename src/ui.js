export class UI {
  constructor(particleSystem) {
    this.particleSystem = particleSystem;
    this.shapeButtons = document.querySelectorAll('[data-shape]');
    this.colorPicker = document.getElementById('color-picker');
    this.fullscreenBtn = document.getElementById('fullscreen-btn');
    
    this.initListeners();
  }

  initListeners() {
    this.shapeButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); // Stop click from propagating to canvas
        const shape = e.target.getAttribute('data-shape');
        this.particleSystem.setShape(shape);
        
        // Update active state
        this.shapeButtons.forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
      });
    });

    this.colorPicker.addEventListener('click', (e) => e.stopPropagation());
    this.colorPicker.addEventListener('input', (e) => {
      this.particleSystem.setColor(e.target.value);
    });

    this.fullscreenBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
      } else {
        if (document.exitFullscreen) {
          document.exitFullscreen();
        }
      }
    });
  }
}

