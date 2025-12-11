import * as THREE from 'three';

export class ParticleSystem {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
    
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.camera.position.z = 50; // Further back initial view

    this.particleCount = 90000;
    this.particles = null;
    this.snowParticles = null;
    this.material = null;
    this.snowMaterial = null;
    this.instancedGeometry = null;
    this.snowGeometry = null;

    // State
    this.currentShape = 'heart';
    // We store targets in CPU for shape generation, but logic happens in Shader
    this.targetPositions = new Float32Array(this.particleCount * 3);
    
    // Hand Tracking State
    this.handPos = new THREE.Vector3(0, 0, 0); // Raw
    this.handRotation = new THREE.Quaternion(); // Raw
    
    // Smoothed State for rendering
    this.smoothedHandPos = new THREE.Vector3(0, 0, 0);
    this.smoothedHandRot = new THREE.Quaternion();
    this.smoothedHandScale = 1.0;

    this.isClosed = false;
    this.color = new THREE.Color('#ff0066');

    // Photo Atlas State - 8x8 grid = 64 photos max
    this.photoAtlasCanvas = null;
    this.photoAtlasCtx = null;
    this.photoCount = 8; // Initial photos loaded
    this.nextPhotoSlot = 8; // Next slot to fill
    this.atlasSize = 4096; // Larger texture for more photos
    this.atlasCols = 8;
    this.atlasRows = 8;

    // Load textures
    this.textureLoader = new THREE.TextureLoader();
    this.photoTexture = this.createPhotoAtlas(); // Updated
    this.sparkleTexture = this.textureLoader.load('/textures/sparkle.png');
    this.particleTexture = this.textureLoader.load('/textures/particle.png');

    this.initParticles();
    // this.initPicking(); // Picking removed
    this.initSnow();
    this.initPopup();
    this.generateShape(this.currentShape);

    // Initial Snow Check
    if (this.snowMaterial) {
        this.snowMaterial.uniforms.uVisible.value = 1.0;
    }
    
    window.addEventListener('resize', this.onResize.bind(this));
    
    // Force add global click listener to document body
    document.body.addEventListener('click', (e) => {
        console.log("Global Body Click Detected!", e.clientX, e.clientY);
        this.onClick(e);
    });
    console.log("Particle System vReloaded - Lerp Speed Adjustment");
  }

  // initPicking removed

  createPhotoAtlas() {
    const canvas = document.createElement('canvas');
    const size = this.atlasSize;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    
    // Store references for later use
    this.photoAtlasCanvas = canvas;
    this.photoAtlasCtx = ctx;
    
    // Fill with black/transparent
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.clearRect(0,0,size,size);
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    
    // Load 8 initial images: 1.jpg to 8.jpg
    // Grid is now dynamic (8x8 = 64 slots)
    const urls = [];
    for(let i=1; i<=8; i++) urls.push(`/photos/${i}.jpg`);
    
    const cols = this.atlasCols;
    const cellW = size / cols;
    const cellH = size / this.atlasRows;
    
    urls.forEach((url, index) => {
        const img = new Image();
        img.onload = () => {
            const c = index % cols;
            const r = Math.floor(index / cols);
            
            // Draw Crop to Square
            const aspect = img.width / img.height;
            let sx=0, sy=0, sw=img.width, sh=img.height;
            
            if (aspect > 1) { // Landscape
                sw = img.height;
                sx = (img.width - img.height) / 2;
            } else { // Portrait
                sh = img.width;
                sy = (img.height - img.width) / 2;
            }
            
            ctx.drawImage(img, sx, sy, sw, sh, c*cellW, r*cellH, cellW, cellH);
            texture.needsUpdate = true;
        };
        img.src = url;
    });

    return texture;
  }

  initParticles() {
    // Base Geometry for each particle (Thin Box/Card)
    const baseGeometry = new THREE.BoxGeometry(0.5, 0.5, 0.05);
    this.instancedGeometry = new THREE.InstancedBufferGeometry();
    this.instancedGeometry.index = baseGeometry.index;
    this.instancedGeometry.attributes.position = baseGeometry.attributes.position;
    this.instancedGeometry.attributes.uv = baseGeometry.attributes.uv;
    this.instancedGeometry.attributes.normal = baseGeometry.attributes.normal;

    const targets = new Float32Array(this.particleCount * 3);
    const randoms = new Float32Array(this.particleCount * 3);
    const imgOffsets = new Float32Array(this.particleCount * 2);
    const colors = new Float32Array(this.particleCount * 3); // Per-particle RGB
    const ids = new Float32Array(this.particleCount);
    const isPhotos = new Float32Array(this.particleCount);
    const sizes = new Float32Array(this.particleCount);

    const defaultColor = new THREE.Color(this.color);

    for (let i = 0; i < this.particleCount; i++) {
      targets[i * 3] = (Math.random() - 0.5) * 50;
      targets[i * 3 + 1] = (Math.random() - 0.5) * 50;
      targets[i * 3 + 2] = (Math.random() - 0.5) * 50;

      randoms[i * 3] = Math.random();
      randoms[i * 3 + 1] = Math.random();
      randoms[i * 3 + 2] = Math.random();
      
      ids[i] = i;
      isPhotos[i] = Math.random() > 0.75 ? 1.0 : 0.0; // Increased to match visual density (25%)
      sizes[i] = 0.8 + Math.random() * 0.7; // Mild size variance for nicer depth

      // Random Texture Offset for grid
      // Initial 8 images spread across grid
      const imgIdx = Math.floor(Math.random() * 8); 
      const col = imgIdx % this.atlasCols;
      const row = Math.floor(imgIdx / this.atlasCols);
      
      // Calculate UV Offset
      // U = col * (1/cols)
      // V = (maxRow - row) * (1/rows) for FlipY texture
      const cellSize = 1.0 / this.atlasCols;
      imgOffsets[i * 2] = col * cellSize;
      imgOffsets[i * 2 + 1] = (this.atlasRows - 1 - row) * cellSize;
      
      // Default Color
      colors[i * 3] = defaultColor.r;
      colors[i * 3 + 1] = defaultColor.g;
      colors[i * 3 + 2] = defaultColor.b;
    }

    this.instancedGeometry.setAttribute('aTargetPos', new THREE.InstancedBufferAttribute(targets, 3));
    this.instancedGeometry.setAttribute('aRandom', new THREE.InstancedBufferAttribute(randoms, 3));
    this.instancedGeometry.setAttribute('aImgOffset', new THREE.InstancedBufferAttribute(imgOffsets, 2));
    this.instancedGeometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(colors, 3));
    this.instancedGeometry.setAttribute('aID', new THREE.InstancedBufferAttribute(ids, 1));
    this.instancedGeometry.setAttribute('aIsPhoto', new THREE.InstancedBufferAttribute(isPhotos, 1));
    this.instancedGeometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(sizes, 1));

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        // uColor is now a fallback or global tint, but we use aColor mostly
        uColor: { value: this.color },
        uPhotoTexture: { value: this.photoTexture },
        uSparkleTexture: { value: this.sparkleTexture },
        uState: { value: 0.0 }, // 0 = Open (Photos), 1 = Closed (Tree/Shape)
        uHandPos: { value: new THREE.Vector3(0, 0, 0) },
        uHandRotation: { value: new THREE.Vector4(0, 0, 0, 1) }, // Quaternion
        uScale: { value: 1.0 },
        uClickedID: { value: -1.0 },
        uAtlasGridSize: { value: this.atlasCols } // Grid size for UV calculation
      },
      vertexShader: `
        uniform float uTime;
        uniform float uState;
        uniform vec3 uHandPos;
        uniform vec4 uHandRotation;
        uniform float uScale;
        uniform float uClickedID; // Added
        
        attribute vec3 aTargetPos;
        attribute vec3 aRandom;
        attribute vec2 aImgOffset;
        attribute vec3 aColor;
        attribute float aID; // Added
        attribute float aIsPhoto; // Added
        attribute float aSize; // Added
        
        varying vec2 vImgOffset;
        varying vec2 vUv;
        varying float vState;
        varying float vRandom;
        varying float vTypeRandom; // Decorrelated random for type
        varying vec3 vColor;
        varying float vIsPhoto; // Pass to frag
        varying float vID; // Pass to frag
        varying float vDepth; // For distance-based dimming
        
        // Quaternion rotation
        vec3 applyQuaternion(vec3 v, vec4 q) {
            return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
        }
        
        // Quadratic Bezier Interpolation
        vec3 quadraticBezier(vec3 p0, vec3 p1, vec3 p2, float t) {
            float oneMinusT = 1.0 - t;
            return oneMinusT * oneMinusT * p0 + 2.0 * oneMinusT * t * p1 + t * t * p2;
        }

        // Pseudo-random function
        float random(vec2 st) {
            return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
        }

        void main() {
          vImgOffset = aImgOffset;
          vUv = uv;
          vState = uState; 
          vRandom = aRandom.x;
          vColor = aColor;
          vIsPhoto = aIsPhoto;
          vID = aID;
          
          // Generate a random value for type that doesn't correlate with position (aRandom components)
          // We mix aRandom components to get a new random seed
          vTypeRandom = random(vec2(aRandom.x * 10.0, aRandom.z * 10.0));
          
          // === POSITIONS ===
          
          // 1. Closed State (Shape/Tree)
          // Add Breathing animation
          float breathe = sin(uTime * 2.0 + aRandom.y * 10.0) * 0.5 + 0.5; // 0..1
          vec3 shapePos = applyQuaternion(aTargetPos, uHandRotation);
          
          // Apply Scale
          shapePos *= uScale * 1.5;
          
          // Mild breathing expansion
          shapePos += normalize(shapePos) * (breathe * 0.2);
          
          // 2. Open State (Cloud/Photos)
          // Float around hand
          float t = uTime * 0.5 + aRandom.x * 10.0;
          vec3 floatOffset = vec3(sin(t), cos(t * 0.8), sin(t * 1.2)) * 3.0;
          
          // Spread logic:
          // X/Y spread: 60 units wide
          // Z spread: Biased backwards to avoid clipping camera (Camera at z=30)
          vec3 randomSpread = (aRandom - 0.5) * vec3(70.0, 60.0, 40.0);
          randomSpread.z -= 10.0; // Push back z (-30 to +10 range approx)
          
          vec3 cloudPos = uHandPos + randomSpread + floatOffset;
          
          // 3. Interpolation (Bezier Explosion)
          // Control point pushes out
          vec3 controlPoint = shapePos + normalize(shapePos) * 20.0;
          
          // uState: 1 = Closed (Shape), 0 = Open (Cloud)
          // We want t to go 0->1 as uState goes 1->0
          float progress = 1.0 - uState;
          
          vec3 finalPos = quadraticBezier(shapePos, controlPoint, cloudPos, progress);

          // === HIDE IF CLICKED ===
          if (abs(aID - uClickedID) < 0.1) {
             gl_Position = vec4(0.0);
             return;
          }

          // === ROTATION / TUMBLING ===
          vec3 transformed = position;
        
          // Tumble when open (uState: 0 = open, 1 = closed)
          float tumbleFactor = (1.0 - uState);
        
          // Always apply rotation, but scale rotation intensity by tumbleFactor
          vec3 axis = normalize(aRandom);
          float angle = uTime * (aRandom.y + 0.5) + aRandom.z * 10.0;
          
          float s = sin(angle);
          float c = cos(angle);
          float oc = 1.0 - c;
          
          mat3 rotMat = mat3(
              oc * axis.x * axis.x + c,           oc * axis.x * axis.y - axis.z * s,  oc * axis.z * axis.x + axis.y * s,
              oc * axis.x * axis.y + axis.z * s,  oc * axis.y * axis.y + c,           oc * axis.y * axis.z - axis.x * s,
              oc * axis.z * axis.x - axis.y * s,  oc * axis.y * axis.z + axis.x * s,  oc * axis.z * axis.z + c
          );
          
          // Blend between rotated (open) and non-rotated (closed) position
          vec3 rotatedPos = rotMat * transformed;
          transformed = mix(transformed, rotatedPos, tumbleFactor);
          
          // Smoothly interpolate size: 2.5 (open) -> 0.9 (closed)
          float openSize = 2.5 * aSize;
          float closedSize = 0.9 * aSize;
          float finalSize = mix(closedSize, openSize, tumbleFactor);
          transformed *= finalSize;

          vec4 mvPosition = modelViewMatrix * vec4(finalPos + transformed, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          
          // Calculate depth for distance-based dimming (0 = close, 1 = far)
          // Normalize depth: camera at z=50, particles roughly -30 to +30
          // Closer particles (higher mvPosition.z / less negative) should be dimmer
          vDepth = clamp((-mvPosition.z - 20.0) / 60.0, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform sampler2D uPhotoTexture;
        uniform sampler2D uSparkleTexture;
        uniform float uClickedID;
        uniform float uAtlasGridSize;

        varying vec2 vImgOffset;
        varying vec2 vUv;
        varying float vState;
        varying float vRandom;
        varying float vTypeRandom;
        varying vec3 vColor;
        varying float vIsPhoto;
        varying float vID;
        varying float vDepth; // For distance-based dimming

        void main() {
          // Texture Coordinates
          // Photos use grid atlas (dynamic size)
          float cellSize = 1.0 / uAtlasGridSize;
          vec2 photoUV = vUv * cellSize + vImgOffset;
          
          // === Open State (Clouds/Photos) ===
          // Use CPU-determined type
          float isPhoto = vIsPhoto;
          
          vec4 photoContent = texture2D(uPhotoTexture, photoUV);
          
          // Photos: visible content but transparent
          // Depth-based dimming to reduce center blowout
          float depthDim = smoothstep(0.0, 1.0, vDepth) * 0.5 + 0.5; // 0.5-1.0 based on depth
          photoContent.rgb *= 0.35 * depthDim; // Visible but not too bright
          photoContent.a *= 0.25; // Very transparent
          
          // No dust for photo particles, just show photos
          // Non-photo particles show nothing in open state
          vec4 openStateColor = isPhoto > 0.5 ? photoContent : vec4(0.0);
          
          
          // === Closed State (Shape) ===
          // Sparkle use full texture
          vec4 closedStateColor = texture2D(uSparkleTexture, vUv);
          // Tint sparkle with per-particle color
          closedStateColor.rgb *= vColor;
          
          // Target brightness for the final tree state
          // Increased from 0.6 to 0.8 to make it brighter (less dimming)
          closedStateColor.rgb *= 0.9; 
          
          
          // === MIXING ===
          // uState: 1.0 = Closed (Sparkle), 0.0 = Open (Photo)
          // Use a Cubic Bezier or smoother step for color transition to make it feel less abrupt
          // Standard smoothstep is Hermite (3t^2 - 2t^3).
          // Let's use a smoother 5th order polynomial (smootherstep) or just delay it slightly.
          
          float t = clamp(vState, 0.0, 1.0);
          // Smootherstep: 6t^5 - 15t^4 + 10t^3
          float mixT = t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
          
          vec4 finalColor = mix(openStateColor, closedStateColor, mixT);
          
          // === TRANSITION DENSITY CONTROL ===
          // REMOVED: No dimming during transition
          // float densityControl = 1.0 - 0.5 * sin(vState * 3.14159);
          // finalColor.rgb *= densityControl;
          
          // Soften particle edges for non-photo sprites to cut aliasing
          float edge = smoothstep(0.98, 0.55, length(vUv - 0.5) * 2.0);
          float alphaMask = mix(edge, 1.0, vIsPhoto); // Keep photos square, soften sparkles
          finalColor.a *= alphaMask;
          
          if (finalColor.a < 0.1) discard;
          gl_FragColor = finalColor;
        }
      `,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      dithering: true
    });

    this.particles = new THREE.InstancedMesh(this.instancedGeometry, this.material, this.particleCount);
    this.scene.add(this.particles);
  }

  onClick(event) {
    console.log("Click detected!"); 
    if (this.isClosed) {
        console.log("Ignored: Hand is closed (Shape mode)");
        return; 
    }

    // New Logic: Show a RANDOM photo globally for 1.5s
    const isPhotoAttr = this.instancedGeometry.attributes.aIsPhoto;
    if (!isPhotoAttr) {
        console.error("Attribute aIsPhoto not found on geometry!");
        return;
    }
    
    const isPhotos = isPhotoAttr.array;
    const count = this.particleCount;
    
    // Select a random photo slot with EQUAL probability (1/n for each photo)
    const randomPhotoSlot = Math.floor(Math.random() * this.photoCount);
    const cellSize = 1.0 / this.atlasCols;
    const col = randomPhotoSlot % this.atlasCols;
    const row = Math.floor(randomPhotoSlot / this.atlasCols);
    
    // Calculate UV offset for this slot
    const ox = col * cellSize;
    const oy = (this.atlasRows - 1 - row) * cellSize;
    
    console.log(`Showing photo slot ${randomPhotoSlot} of ${this.photoCount} (probability: ${(100/this.photoCount).toFixed(1)}%)`);
    
    // Find a photo particle to use as starting position
    let randomID = -1;
    for(let i=0; i<100; i++) {
        const r = Math.floor(Math.random() * count);
        if (isPhotos[r] > 0.5) {
            randomID = r;
            break;
        }
    }
    
    if (randomID !== -1) {
        // Hide original particle
        if(this.material.uniforms.uClickedID) {
            this.material.uniforms.uClickedID.value = randomID;
        }
        
        // Trigger Popup with the randomly selected photo (equal probability)
        const startPos = this.getParticlePos(randomID);
        
        this.popupMesh.material.uniforms.uImgOffset.value.set(ox, oy);
        
        this.popupState.active = true;
        this.popupState.timer = 0;
        this.popupState.startPos.copy(startPos);
        this.popupState.id = randomID;
        
        this.popupMesh.visible = true;
        this.popupMesh.position.copy(startPos);
        this.popupMesh.scale.set(0.1, 0.1, 0.1);

    } else {
        console.warn("Failed to find a photo particle after 100 tries");
    }
  }

  createSnowflakeTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.clearRect(0, 0, 128, 128);

    ctx.strokeStyle = 'white';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.shadowBlur = 5;
    ctx.shadowColor = 'white';

    const cx = 64;
    const cy = 64;
    const radius = 45;

    // Draw 6 branches
    for (let i = 0; i < 6; i++) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate((i * 60 * Math.PI) / 180);

        // Main branch
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -radius);
        ctx.stroke();

        // Sub-branches (V shapes)
        const branchSize = 12;
        // Inner V
        ctx.beginPath();
        ctx.moveTo(0, -radius * 0.4);
        ctx.lineTo(-branchSize, -radius * 0.6);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, -radius * 0.4);
        ctx.lineTo(branchSize, -radius * 0.6);
        ctx.stroke();

        // Outer V
        ctx.beginPath();
        ctx.moveTo(0, -radius * 0.7);
        ctx.lineTo(-branchSize * 0.8, -radius * 0.9);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, -radius * 0.7);
        ctx.lineTo(branchSize * 0.8, -radius * 0.9);
        ctx.stroke();

        ctx.restore();
    }
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  initSnow() {
      const snowCount = 10000; // Increased count for better effect
      const geometry = new THREE.PlaneGeometry(0.3, 0.3); // Slightly smaller individual flakes
      this.snowGeometry = new THREE.InstancedBufferGeometry();
      this.snowGeometry.index = geometry.index;
      this.snowGeometry.attributes.position = geometry.attributes.position;
      this.snowGeometry.attributes.uv = geometry.attributes.uv;
      
      const offsets = new Float32Array(snowCount * 3);
      const speeds = new Float32Array(snowCount);
      const randoms = new Float32Array(snowCount * 2); // Sway params
      const rotSpeeds = new Float32Array(snowCount * 3); // Rotation axis/speed

      for(let i=0; i<snowCount; i++) {
          offsets[i*3] = (Math.random() - 0.5) * 60;
          offsets[i*3+1] = Math.random() * 40 - 10;
          offsets[i*3+2] = (Math.random() - 0.5) * 60;
          
          speeds[i] = 1.0 + Math.random() * 3.0;
          randoms[i*2] = Math.random();
          randoms[i*2+1] = Math.random();
          
          rotSpeeds[i*3] = (Math.random() - 0.5) * 2.0;
          rotSpeeds[i*3+1] = (Math.random() - 0.5) * 2.0;
          rotSpeeds[i*3+2] = (Math.random() - 0.5) * 2.0;
      }

      this.snowGeometry.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
      this.snowGeometry.setAttribute('aSpeed', new THREE.InstancedBufferAttribute(speeds, 1));
      this.snowGeometry.setAttribute('aRandom', new THREE.InstancedBufferAttribute(randoms, 2));
      this.snowGeometry.setAttribute('aRotSpeed', new THREE.InstancedBufferAttribute(rotSpeeds, 3));

      this.snowMaterial = new THREE.ShaderMaterial({
          uniforms: {
              uTime: { value: 0 },
              uTexture: { value: this.createSnowflakeTexture() },
              uVisible: { value: 1.0 } // Default to visible
          },
          vertexShader: `
             uniform float uTime;
             attribute vec3 aOffset;
             attribute float aSpeed;
             attribute vec2 aRandom;
             attribute vec3 aRotSpeed;
             varying vec2 vUv;
             
             // Rotation Matrix
             mat4 rotationMatrix(vec3 axis, float angle) {
                axis = normalize(axis);
                float s = sin(angle);
                float c = cos(angle);
                float oc = 1.0 - c;
                
                return mat4(
                    oc * axis.x * axis.x + c,           oc * axis.x * axis.y - axis.z * s,  oc * axis.z * axis.x + axis.y * s,  0.0,
                    oc * axis.x * axis.y + axis.z * s,  oc * axis.y * axis.y + c,           oc * axis.y * axis.z - axis.x * s,  0.0,
                    oc * axis.z * axis.x - axis.y * s,  oc * axis.y * axis.z + axis.x * s,  oc * axis.z * axis.z + c,           0.0,
                    0.0,                                0.0,                                0.0,                                1.0
                );
            }

             void main() {
                 vUv = uv;
                 vec3 pos = aOffset;
                 
                 // Fall
                 float y = pos.y - uTime * aSpeed;
                 // Wrap around (-10 to 30 range = 40 units)
                 // Increase range to -20 to 30 to cover more screen
                 y = mod(y + 10000.0, 50.0) - 20.0;
                 
                 // Sway
                 float swayX = sin(uTime * 1.5 + aRandom.x * 10.0) * 0.5;
                 float swayZ = cos(uTime * 1.2 + aRandom.y * 10.0) * 0.5;
                 
                 // Wind
                 float wind = sin(uTime * 0.5) * 1.5;
                 
                 pos.y = y;
                 pos.x += swayX + wind;
                 pos.z += swayZ;
                 
                 // Tumbling Rotation
                 // Rotate the vertex itself before adding to position
                 float angle = uTime * length(aRotSpeed);
                 vec3 axis = aRotSpeed;
                 if (length(axis) < 0.01) axis = vec3(1.0, 0.0, 0.0);
                 
                 mat4 rot = rotationMatrix(axis, angle);
                 vec4 rotatedVertex = rot * vec4(position, 1.0);
                 
                 vec4 mvPosition = modelViewMatrix * vec4(pos + rotatedVertex.xyz, 1.0);
                 
                 gl_Position = projectionMatrix * mvPosition;
             }
          `,
          fragmentShader: `
             uniform sampler2D uTexture;
             uniform float uVisible;
             varying vec2 vUv;
             void main() {
                 if (uVisible < 0.1) discard;
                 vec4 color = texture2D(uTexture, vUv);
                 // Boost white
                 color.rgb *= 1.5;
                 if (color.a < 0.1) discard;
                 gl_FragColor = color;
             }
          `,
          depthWrite: false, 
          blending: THREE.AdditiveBlending,
          transparent: true,
          side: THREE.DoubleSide,
          dithering: true
      });
      
      this.snowParticles = new THREE.InstancedMesh(this.snowGeometry, this.snowMaterial, snowCount);
      // Ensure it renders last or with particles
      this.snowParticles.renderOrder = 1; 
      // Prevent frustum culling since vertices are moved in shader
      this.snowParticles.frustumCulled = false;
      this.scene.add(this.snowParticles);
      console.log("Snow particles updated with procedural texture:", snowCount);
  }

  generateShape(type) {
    const allowedShapes = ['heart', 'planet', 'star', 'tree'];
    if (!allowedShapes.includes(type)) {
        type = 'heart';
    }
    this.currentShape = type;
    const positions = this.instancedGeometry.attributes.aTargetPos.array;
    const colors = this.instancedGeometry.attributes.aColor.array;
    
    let idx = 0;
    let cIdx = 0;
    
    // Helper colors
    const setRGB = (r, g, b) => {
        colors[cIdx++] = r;
        colors[cIdx++] = g;
        colors[cIdx++] = b;
    };
    const setHex = (hex) => {
        const c = new THREE.Color(hex);
        setRGB(c.r, c.g, c.b);
    };

    // Helper: Random point in unit sphere
    const randomInSphere = () => {
        const u = Math.random();
        const v = Math.random();
        const theta = 2 * Math.PI * u;
        const phi = Math.acos(2 * v - 1);
        const r = Math.cbrt(Math.random());
        return new THREE.Vector3(
            r * Math.sin(phi) * Math.cos(theta),
            r * Math.sin(phi) * Math.sin(theta),
            r * Math.cos(phi)
        );
    };

    if (type === 'heart') {
       // 3D Heart Volume
       for (let i = 0; i < this.particleCount; i++) {
         setHex(this.color); // Default Pink/Red
         
         let p = new THREE.Vector3();
         while(true) {
             p.set(
                 (Math.random() - 0.5) * 3,
                 (Math.random() - 0.5) * 3,
                 (Math.random() - 0.5) * 3
             );
             const x = p.x; const y = p.y; const z = p.z;
             const a = x*x + 9/4*y*y + z*z - 1;
             if (a*a*a - x*x*z*z*z - 9/80*y*y*z*z*z < 0) break;
         }
         positions[idx++] = p.x * 10;
         positions[idx++] = p.y * 10;
         positions[idx++] = p.z * 10;
       }
    } else if (type === 'flower') {
        for (let i = 0; i < this.particleCount; i++) {
             setHex(this.color);
             
             const u = Math.random();
             const v = Math.random();
             const theta = Math.random() * Math.PI * 2;
             const phi = Math.acos(2 * Math.random() - 1);
             const r = 10 + 5 * Math.sin(5 * theta) * Math.sin(phi);
             const rFinal = r + (Math.random() - 0.5) * 2;
             
             let x = rFinal * Math.sin(phi) * Math.cos(theta);
             let y = rFinal * Math.sin(phi) * Math.sin(theta);
             let z = rFinal * Math.cos(phi);
             positions[idx++] = x; positions[idx++] = y; positions[idx++] = z;
        }
    } else if (type === 'planet') { 
        // Planet: banded core + layered rings + moons
        const tiltX = 0.4; 
        const tiltZ = 0.2;
        for (let i = 0; i < this.particleCount; i++) {
            const r = Math.random();
            if (r < 0.55) {
                // Core planet with subtle latitude bands
                const dir = randomInSphere().normalize();
                const latitude = Math.asin(dir.y);
                const band = Math.sin(latitude * 4.0 + Math.random() * 0.4) * 0.5 + 0.5;
                const coreRadius = 10.0 + Math.random() * 0.8; // Keep radius consistent so planet stays round
                const coreColor = new THREE.Color().setHSL(0.04 + band * 0.025, 0.7, 0.28 + band * 0.25);
                setRGB(coreColor.r, coreColor.g, coreColor.b);
                
                const pos = dir.multiplyScalar(coreRadius);
                positions[idx++] = pos.x; 
                positions[idx++] = pos.y; 
                positions[idx++] = pos.z;
            } else if (r < 0.78) {
                // Main metallic ring
                const angle = Math.random() * Math.PI * 2;
                const dist = 14 + Math.random() * 10;
                const height = (Math.random() - 0.5) * 0.6; // Thin ring
                
                const goldMix = 0.6 + Math.random() * 0.3;
                const ringColor = new THREE.Color('#c9a34a').lerp(new THREE.Color('#f3d38c'), goldMix);
                setRGB(ringColor.r, ringColor.g, ringColor.b);

                let x = dist * Math.cos(angle);
                let z = dist * Math.sin(angle);
                let y = height;

                let y1 = y * Math.cos(tiltX) - z * Math.sin(tiltX);
                let z1 = y * Math.sin(tiltX) + z * Math.cos(tiltX);
                let x1 = x;
                
                let x2 = x1 * Math.cos(tiltZ) - y1 * Math.sin(tiltZ);
                let y2 = x1 * Math.sin(tiltZ) + y1 * Math.cos(tiltZ);
                let z2 = z1;

                positions[idx++] = x2; positions[idx++] = y2; positions[idx++] = z2;
            } else if (r < 0.92) {
                // Dusty arcs and secondary debris rings
                const angle = Math.random() * Math.PI * 2;
                const isVerticalArc = Math.random() < 0.35;
                const dist = isVerticalArc ? (18 + Math.random() * 6) : (24 + Math.random() * 6);
                const height = isVerticalArc ? (Math.random() - 0.5) * 8.0 : (Math.random() - 0.5) * 2.5;
                
                const colorBase = new THREE.Color('#d3b17d').lerp(new THREE.Color('#8c5c2b'), Math.random() * 0.4);
                setRGB(colorBase.r, colorBase.g, colorBase.b);
                
                let x = dist * Math.cos(angle);
                let z = dist * Math.sin(angle);
                let y = height + Math.sin(angle * 2.0) * 0.4; // Warp for arc feel

                let y1 = y * Math.cos(tiltX) - z * Math.sin(tiltX);
                let z1 = y * Math.sin(tiltX) + z * Math.cos(tiltX);
                let x1 = x;
                
                let x2 = x1 * Math.cos(tiltZ) - y1 * Math.sin(tiltZ);
                let y2 = x1 * Math.sin(tiltZ) + y1 * Math.cos(tiltZ);
                let z2 = z1;

                positions[idx++] = x2; positions[idx++] = y2; positions[idx++] = z2;
            } else {
                // Moons and glowing specks
                const moonOffsets = [
                    {r: 20, a: 0.0},
                    {r: 27, a: 2.1},
                    {r: 16, a: 4.5},
                    {r: 22, a: 5.4}
                ];
                const m = moonOffsets[Math.floor(Math.random() * moonOffsets.length)];
                const dir = randomInSphere();
                const moonR = 1.8 + Math.random() * 0.8;
                
                const moonColor = new THREE.Color('#f0f8ff').lerp(new THREE.Color('#ffefd5'), Math.random() * 0.4);
                setRGB(moonColor.r, moonColor.g, moonColor.b);

                const mx = m.r * Math.cos(m.a);
                const mz = m.r * Math.sin(m.a);
                const my = 0;
                
                let y1 = my * Math.cos(tiltX) - mz * Math.sin(tiltX);
                let z1 = my * Math.sin(tiltX) + mz * Math.cos(tiltX);
                let x1 = mx;
                let x2 = x1 * Math.cos(tiltZ) - y1 * Math.sin(tiltZ);
                let y2 = x1 * Math.sin(tiltZ) + y1 * Math.cos(tiltZ);
                let z2 = z1;

                positions[idx++] = x2 + dir.x * moonR; 
                positions[idx++] = y2 + dir.y * moonR; 
                positions[idx++] = z2 + dir.z * moonR;
            }
        }
    } else if (type === 'star') {
        for (let i = 0; i < this.particleCount; i++) {
             setHex(this.color);
             const p = randomInSphere();
             const dir = p.clone().normalize();
             const theta = Math.atan2(dir.z, dir.x);
             const phi = Math.acos(dir.y); // Y up
             const rBase = 8;
             const spike = Math.pow(Math.abs(Math.cos(2.5 * theta) * Math.sin(phi)), 4.0) * 15;
             const r = rBase + spike + (Math.random()*2);
             positions[idx++] = dir.x * r;
             positions[idx++] = dir.y * r;
             positions[idx++] = dir.z * r;
        }
    } else if (type === 'tree') {
        const layers = 7; // Matches Christmas-tree config
        const starCenter = new THREE.Vector3(0, 11, 0);
        for (let i = 0; i < this.particleCount; i++) {
             const t = Math.random();
             
             // Trunk cluster
             if (t < 0.08) {
                 setHex('#4a2e16'); // Wood tone
                 const theta = Math.random() * Math.PI * 2;
                 const r = 0.6 + Math.random() * 0.8;
                 const y = -10 + Math.random() * 4;
                 
                 positions[idx++] = r * Math.cos(theta) * 0.8;
                 positions[idx++] = y;
                 positions[idx++] = r * Math.sin(theta) * 0.8;
                 continue;
             }
             
             // Star topper
             if (t > 0.94) {
                 setHex('#FFD700');
                 const dir = randomInSphere().normalize();
                 const s = 1.0 + Math.random() * 0.8;
                 
                 positions[idx++] = starCenter.x + dir.x * s;
                 positions[idx++] = starCenter.y + dir.y * s;
                 positions[idx++] = starCenter.z + dir.z * s;
                 continue;
             }

             const y = (t * 20) - 10; // -10 to 10 height
             const layerT = t * layers;
             const layerProgress = layerT % 1;
             const layerShape = Math.pow(1 - layerProgress, 0.8);
             const maxR = 6.5; // Scaled to fit screen
             const rBoundary = (1 - t) * maxR * (0.75 + 0.5 * layerShape);
             const theta = Math.random() * Math.PI * 2;
             const wobble = Math.sin(theta * 3.0 + layerT) * 0.2;
             const r = rBoundary * Math.sqrt(0.1 + 0.9 * Math.random());
             const edgeFactor = rBoundary > 0 ? (r / rBoundary) : 0.0;
             const yPos = y + wobble;

             // Garland wrap
             if (Math.random() < 0.12) {
                 setHex('#FFD966');
                 const turns = 4.5;
                 const angle = t * turns * 2 * Math.PI;
                 const garlandR = rBoundary * 0.85 + 0.3;
                 positions[idx++] = garlandR * Math.cos(angle);
                 positions[idx++] = yPos;
                 positions[idx++] = garlandR * Math.sin(angle);
                 continue;
             }
             
             // Ornaments and snowy tips
             if (Math.random() < (0.12 + edgeFactor * 0.25)) {
                 setHex('#e6f6ff'); // Snow frosting
             } else if (Math.random() < 0.14) {
                 const ornamentType = Math.random();
                 if (ornamentType < 0.33) setHex('#FF0000'); // Red
                 else if (ornamentType < 0.66) setHex('#FFD700'); // Gold
                 else setHex('#1E90FF'); // Dodger Blue
             } else {
                 setHex('#0f5e2f'); // Forest Green
             }
             
             positions[idx++] = r * Math.cos(theta);
             positions[idx++] = yPos;
             positions[idx++] = r * Math.sin(theta);
        }
    }

    this.instancedGeometry.attributes.aTargetPos.needsUpdate = true;
    this.instancedGeometry.attributes.aColor.needsUpdate = true;
  }

  update(dt, handData) {
    this.material.uniforms.uTime.value += dt;
    if (this.snowMaterial) {
        this.snowMaterial.uniforms.uTime.value += dt;
        // console.log("Snow Time:", this.snowMaterial.uniforms.uTime.value);
    }

    if (handData) {
        // Map hand position (0..1) to scene coords (-20..20 approx)
        const x = (handData.position.x - 0.5) * 40;
        const y = -(handData.position.y - 0.5) * 30; 
        this.handPos.set(x, y, 0);
        this.isClosed = handData.isClosed;
        
        // --- STABILIZATION & SMOOTHING ---
        
        // 1. Position Smoothing (LERP)
        // Adaptive Smoothing:
        // If closed (fist), use very strong smoothing (low lerp factor) to remove shake.
        // If open, use lighter smoothing for responsiveness.
        const posLerpFactor = this.isClosed ? 0.03 : 0.15; 
        
        this.smoothedHandPos.lerp(this.handPos, posLerpFactor);
        this.material.uniforms.uHandPos.value.copy(this.smoothedHandPos);
        
        // 2. Rotation Smoothing (SLERP)
        if (handData.rotation) {
             this.handRotation.copy(handData.rotation);
             
             // Apply Position-based Pitch (Vertical Tilt)
             // Map Y (-15 to +15) to Angle (-60 to +60 degrees)
             // Moving UP (Positive Y) -> Tilt Backward (Negative X Rotation) -> Look Up
             // Use a wider input range to make it less sensitive? Or more?
             const maxTilt = Math.PI / 2.5; // ~72 degrees
             // Hand Y is roughly -15 (bottom) to +15 (top).
             // Clamp and normalize
             const normalizedY = Math.max(-1, Math.min(1, this.smoothedHandPos.y / 15.0));
             
             // Multiply by rotation matrix to rotate around local or global X?
             // Premultiply = Global X axis (Screen Horizontal)
             const tiltAngle = -normalizedY * maxTilt;
             
             const tiltQuat = new THREE.Quaternion();
             tiltQuat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), tiltAngle);
             
             // Overwrite X rotation from hand with our calculated tilt?
             // Hand tracking "X" rotation (pitch) is notoriously unstable/hard to control with wrist.
             // Let's TRY to Isolate the Z (roll) and Y (yaw) from hand, and force X (pitch) based on height.
             
             // Get Euler from current hand rotation
             const euler = new THREE.Euler();
             euler.setFromQuaternion(this.handRotation, 'YXZ'); // Order matters
             
             // euler.x is Pitch. euler.y is Yaw. euler.z is Roll.
             // Replace Pitch with our height-based tilt
             euler.x = tiltAngle;
             
             // Reconstruct Quaternion
             this.handRotation.setFromEuler(euler);
             
             this.smoothedHandRot.slerp(this.handRotation, posLerpFactor);
             this.material.uniforms.uHandRotation.value.copy(this.smoothedHandRot);
        }
        
        // 3. Scale Smoothing (LERP)
        if (handData.scale) {
            // Normalize scale. 
            // Typical palm width/dist is 0.1 (far) to 0.3 (close).
            // Map 0.1 -> 0.5x, 0.3 -> 1.5x
            const minS = 0.1; 
            const maxS = 0.3;
            // Linear map
            let s = (handData.scale - minS) / (maxS - minS); 
            // Clamp 0..1
            s = Math.max(0.0, Math.min(1.0, s));
            
            // Map to output scale range (e.g., 0.8 to 2.4)
            // Slightly increased base size (0.5 -> 0.8) and range
            const finalScale = 1.0 + s * 1.5;
            
            // Smooth it
            this.smoothedHandScale += (finalScale - this.smoothedHandScale) * posLerpFactor;
            this.material.uniforms.uScale.value = this.smoothedHandScale;
        }
        
        // Smooth transition for uState
        // Closed = 1.0, Open = 0.0
        const targetState = this.isClosed ? 1.0 : 0.0;
        
        // Slower transition for Bezier curve to look nice
        const lerpSpeed = 0.5; 
        this.material.uniforms.uState.value += (targetState - this.material.uniforms.uState.value) * lerpSpeed * dt;
    } 

    this.renderer.render(this.scene, this.camera);
    
    this.updatePopup(dt);
  }

  setColor(hex) {
      this.color.set(hex);
      this.material.uniforms.uColor.value.copy(this.color);
  }

  setShape(shape) {
      this.generateShape(shape);
      const appliedShape = this.currentShape;
      
      // Auto-set theme color for specific shapes if desired
      if (appliedShape === 'planet') {
          this.setColor('#800000'); // Maroon Red
      } else if (appliedShape === 'tree') {
          this.setColor('#0f5e2f'); // Forest Green (Optional, user can override)
      }
      
      // Toggle Snow - Enable for ALL shapes now
      if (this.snowMaterial) {
          this.snowMaterial.uniforms.uVisible.value = 1.0;
      }
  }

  addPhotoToAtlas(img) {
    if (!this.photoAtlasCtx || !this.photoAtlasCanvas) {
      console.error('Photo atlas not initialized');
      return false;
    }

    // Calculate slot position (0-8, wrapping around)
    const slot = this.nextPhotoSlot % (this.atlasCols * this.atlasRows);
    
    // Draw the image at this slot
    this._drawImageToSlot(img, slot);

    // Update counters
    this.nextPhotoSlot++;
    if (this.nextPhotoSlot > this.photoCount) {
      this.photoCount = Math.min(this.nextPhotoSlot, this.atlasCols * this.atlasRows);
    }

    // Update particle image offsets to include new photos
    this.updateParticlePhotoAssignments();

    console.log(`Added photo to slot ${slot}. Total: ${this.photoCount}`);
    return slot; // Return the slot number for database storage
  }

  addPhotoToAtlasAtSlot(img, slot) {
    if (!this.photoAtlasCtx || !this.photoAtlasCanvas) {
      console.error('Photo atlas not initialized');
      return false;
    }

    // Draw the image at the specified slot
    this._drawImageToSlot(img, slot);

    // Update photo count if this slot is beyond current count
    const maxSlots = this.atlasCols * this.atlasRows;
    if (slot >= this.photoCount && slot < maxSlots) {
      this.photoCount = slot + 1;
    }
    
    // Track highest slot for next auto-assignment
    if (slot >= this.nextPhotoSlot) {
      this.nextPhotoSlot = slot + 1;
    }

    // Update particle image offsets
    this.updateParticlePhotoAssignments();

    console.log(`Loaded photo to slot ${slot}. Total: ${this.photoCount}`);
    return true;
  }

  _drawImageToSlot(img, slot) {
    const ctx = this.photoAtlasCtx;
    const size = this.atlasSize;
    const cols = this.atlasCols;
    const cellW = size / cols;
    const cellH = size / this.atlasRows;

    const col = slot % cols;
    const row = Math.floor(slot / cols);

    // Draw cropped to square (center crop)
    const aspect = img.width / img.height;
    let sx = 0, sy = 0, sw = img.width, sh = img.height;

    if (aspect > 1) {
      // Landscape - crop sides
      sw = img.height;
      sx = (img.width - img.height) / 2;
    } else {
      // Portrait - crop top/bottom
      sh = img.width;
      sy = (img.height - img.width) / 2;
    }

    // Draw to atlas
    ctx.drawImage(img, sx, sy, sw, sh, col * cellW, row * cellH, cellW, cellH);

    // Update texture
    this.photoTexture.needsUpdate = true;
  }

  updateParticlePhotoAssignments() {
    // Reassign ALL photo particles to use any photo with equal probability
    const imgOffsets = this.instancedGeometry.attributes.aImgOffset.array;
    const isPhotos = this.instancedGeometry.attributes.aIsPhoto.array;
    const cols = this.atlasCols;
    const maxSlots = Math.min(this.photoCount, cols * this.atlasRows);
    const cellSize = 1.0 / cols;

    // Reassign ALL photo particles - each photo has 1/n probability
    for (let i = 0; i < this.particleCount; i++) {
      if (isPhotos[i] > 0.5) {
        const imgIdx = Math.floor(Math.random() * maxSlots);
        const col = imgIdx % cols;
        const row = Math.floor(imgIdx / cols);

        imgOffsets[i * 2] = col * cellSize;
        imgOffsets[i * 2 + 1] = (this.atlasRows - 1 - row) * cellSize;
      }
    }

    this.instancedGeometry.attributes.aImgOffset.needsUpdate = true;
    console.log(`Redistributed particles across ${maxSlots} photos (each ~${(100/maxSlots).toFixed(1)}% probability)`);
  }

  getPhotoCount() {
    return this.photoCount;
  }

  initPopup() {
    // 15x scale of 0.5 = 7.5 size
    const geometry = new THREE.PlaneGeometry(7.5, 7.5); 
    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTexture: { value: this.photoTexture },
            uImgOffset: { value: new THREE.Vector2(0, 0) },
            uOpacity: { value: 1.0 },
            uAtlasGridSize: { value: this.atlasCols }
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform sampler2D uTexture;
            uniform vec2 uImgOffset;
            uniform float uOpacity;
            uniform float uAtlasGridSize;
            varying vec2 vUv;
            void main() {
                float cellSize = 1.0 / uAtlasGridSize;
                vec2 uv = vUv * cellSize + uImgOffset;
                vec4 color = texture2D(uTexture, uv);
                gl_FragColor = vec4(color.rgb, color.a * uOpacity);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending,
        dithering: true
    });
    
    this.popupMesh = new THREE.Mesh(geometry, material);
    this.popupMesh.visible = false;
    this.popupMesh.renderOrder = 999;
    this.scene.add(this.popupMesh);
    
    this.popupState = {
        active: false,
        timer: 0,
        totalDuration: 1.5,
        startPos: new THREE.Vector3(),
        targetPos: new THREE.Vector3(0, 0, 42),
        id: -1
    };
  }

  getParticlePos(id) {
     const attr = this.instancedGeometry.attributes;
     const tPos = new THREE.Vector3(
         attr.aTargetPos.array[id*3],
         attr.aTargetPos.array[id*3+1],
         attr.aTargetPos.array[id*3+2]
     );
     const rand = new THREE.Vector3(
         attr.aRandom.array[id*3],
         attr.aRandom.array[id*3+1],
         attr.aRandom.array[id*3+2]
     );
     
     // 1. Closed State
     const uTime = this.material.uniforms.uTime.value;
     const breathe = Math.sin(uTime * 2.0 + rand.y * 10.0) * 0.5 + 0.5;
     
     const shapePos = tPos.clone().applyQuaternion(this.material.uniforms.uHandRotation.value);
     shapePos.multiplyScalar(this.material.uniforms.uScale.value);
     shapePos.add(shapePos.clone().normalize().multiplyScalar(breathe * 0.2));
     
     // 2. Open State
     const t = uTime * 0.5 + rand.x * 10.0;
     const floatOffset = new THREE.Vector3(Math.sin(t), Math.cos(t * 0.8), Math.sin(t * 1.2)).multiplyScalar(3.0);
     
     const randomSpread = rand.clone().subScalar(0.5).multiply(new THREE.Vector3(70.0, 60.0, 40.0));
     randomSpread.z -= 10.0;
     
     const handPos = this.material.uniforms.uHandPos.value;
     const cloudPos = handPos.clone().add(randomSpread).add(floatOffset);
     
     // 3. Interpolation
     const controlPoint = shapePos.clone().add(shapePos.clone().normalize().multiplyScalar(20.0));
     const uState = this.material.uniforms.uState.value;
     const progress = 1.0 - uState;
     
     // Bezier
     const oneMinusT = 1.0 - progress;
     const finalPos = new THREE.Vector3()
        .addScaledVector(shapePos, oneMinusT * oneMinusT)
        .addScaledVector(controlPoint, 2.0 * oneMinusT * progress)
        .addScaledVector(cloudPos, progress * progress);
     
     return finalPos;
  }

  updatePopup(dt) {
      if (!this.popupState.active) return;
      
      this.popupState.timer += dt;
      const t = this.popupState.timer;
      
      // Animation Logic
      let factor = 0;
      if (t < 0.3) {
          factor = Math.sin((t / 0.3) * (Math.PI / 2)); // Ease Out
      } else if (t < 1.2) {
          factor = 1.0;
      } else if (t < 1.5) {
          factor = 1.0 - (t - 1.2) / 0.3;
      } else {
          // End
          this.popupState.active = false;
          this.popupMesh.visible = false;
          this.material.uniforms.uClickedID.value = -1.0;
          return;
      }
      
      // Lerp Position
      const currentPos = new THREE.Vector3().lerpVectors(this.popupState.startPos, this.popupState.targetPos, factor);
      this.popupMesh.position.copy(currentPos);
      
      // Scale: 0.2 -> 1.0
      const s = 0.2 + 0.8 * factor;
      this.popupMesh.scale.set(s, s, s);
      
      // Rotation: Face camera
      this.popupMesh.quaternion.copy(this.camera.quaternion);
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
