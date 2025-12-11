import { photoDatabase } from './database.js';

export class UI {
  constructor(particleSystem) {
    this.particleSystem = particleSystem;
    this.shapeButtons = document.querySelectorAll('[data-shape]');
    this.colorPicker = document.getElementById('color-picker');
    this.fullscreenBtn = document.getElementById('fullscreen-btn');
    this.dropZone = document.getElementById('drop-zone');
    this.dropOverlay = document.getElementById('drop-overlay');
    this.fileInput = document.getElementById('file-input');
    this.photoCount = document.getElementById('photo-count');
    this.dbConnected = false;
    
    this.initListeners();
    this.initDragDrop();
    this.initDatabase();
  }

  async initDatabase() {
    this.dbConnected = await photoDatabase.init();
    
    if (this.dbConnected) {
      this.showToast('☁️ Connected to photo database', 'success');
      await this.loadPhotosFromDatabase();
    } else {
      console.log('Running without database - photos stored in memory only');
    }
  }

  async loadPhotosFromDatabase() {
    const photos = await photoDatabase.loadAllPhotos();
    
    if (photos.length > 0) {
      let loadedCount = 0;
      
      for (const photo of photos) {
        const img = new Image();
        img.onload = () => {
          this.particleSystem.addPhotoToAtlasAtSlot(img, photo.slot);
          loadedCount++;
          
          if (loadedCount === photos.length) {
            const count = this.particleSystem.getPhotoCount();
            this.photoCount.textContent = `${count} photos loaded`;
            this.showToast(`📷 Restored ${photos.length} photo${photos.length > 1 ? 's' : ''} from cloud`, 'success');
          }
        };
        img.src = photo.image_data;
      }
    }
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

  initDragDrop() {
    // Drop zone click to open file picker
    this.dropZone.addEventListener('click', (e) => {
      e.stopPropagation();
      this.fileInput.click();
    });

    // File input change
    this.fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        this.handleFiles(Array.from(e.target.files));
      }
    });

    // Drop zone drag events
    this.dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.dropZone.classList.add('dragover');
    });

    this.dropZone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.dropZone.classList.remove('dragover');
    });

    this.dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.dropZone.classList.remove('dragover');
      
      const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
      if (files.length > 0) {
        this.handleFiles(files);
      }
    });

    // Full page drag events for overlay
    let dragCounter = 0;

    document.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragCounter++;
      if (e.dataTransfer.types.includes('Files')) {
        this.dropOverlay.classList.add('active');
      }
    });

    document.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter === 0) {
        this.dropOverlay.classList.remove('active');
      }
    });

    document.addEventListener('dragover', (e) => {
      e.preventDefault();
    });

    document.addEventListener('drop', (e) => {
      e.preventDefault();
      dragCounter = 0;
      this.dropOverlay.classList.remove('active');
      
      const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
      if (files.length > 0) {
        this.handleFiles(files);
      }
    });
  }

  handleFiles(files) {
    console.log(`Processing ${files.length} image(s)...`);
    
    let loadedCount = 0;
    const totalFiles = files.length;

    files.forEach((file) => {
      const reader = new FileReader();
      
      reader.onload = async (e) => {
        const imageDataUrl = e.target.result;
        const img = new Image();
        
        img.onload = async () => {
          // Add to particle system's photo atlas
          const slot = this.particleSystem.addPhotoToAtlas(img);
          loadedCount++;
          
          // Save to database if connected
          if (this.dbConnected && slot !== false) {
            await photoDatabase.savePhoto(slot, imageDataUrl);
          }
          
          if (loadedCount === totalFiles) {
            // Update count display
            const count = this.particleSystem.getPhotoCount();
            this.photoCount.textContent = `${count} photos loaded`;
            
            // Show toast
            const dbStatus = this.dbConnected ? ' (saved to cloud ☁️)' : '';
            this.showToast(`✨ Added ${totalFiles} photo${totalFiles > 1 ? 's' : ''}!${dbStatus}`, 'success');
          }
        };
        img.src = imageDataUrl;
      };
      
      reader.readAsDataURL(file);
    });
  }

  showToast(message, type = '') {
    // Remove existing toast
    const existingToast = document.querySelector('.toast');
    if (existingToast) {
      existingToast.remove();
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    // Remove after delay
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 400);
    }, 2500);
  }
}

