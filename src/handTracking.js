import { Hands } from '@mediapipe/hands';
import { Camera } from '@mediapipe/camera_utils';
import * as THREE from 'three';

export class HandTracker {
  constructor(videoElement) {
    this.videoElement = videoElement;
    this.results = null;
    this.onResultsCallback = null;
    this.isClosed = false;
    this.handPosition = { x: 0.5, y: 0.5 };
    this.rotation = new THREE.Quaternion();
    
    this.hands = new Hands({locateFile: (file) => {
      return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
    }});

    this.hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    this.hands.onResults(this.handleResults.bind(this));

    this.camera = new Camera(this.videoElement, {
      onFrame: async () => {
        await this.hands.send({image: this.videoElement});
      },
      width: 640,
      height: 480
    });
  }

  start() {
    this.camera.start();
  }

  handleResults(results) {
    this.results = results;
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      const landmarks = results.multiHandLandmarks[0];
      this.updateHandState(landmarks);
      if (this.onResultsCallback) {
        this.onResultsCallback(this.getState());
      }
    } else {
        // No hand detected
        if (this.onResultsCallback) {
            this.onResultsCallback(null);
        }
    }
  }

  updateHandState(landmarks) {
    // 0 is wrist
    // Tips: 8 (Index), 12 (Middle), 16 (Ring), 20 (Pinky)
    // MCPs (Knuckles): 5, 9, 13, 17
    
    const wrist = landmarks[0];
    const tips = [8, 12, 16, 20].map(i => landmarks[i]);
    const mcps = [5, 9, 13, 17].map(i => landmarks[i]);

    // Calculate average distance from wrist to tips
    let avgTipDist = 0;
    tips.forEach(tip => {
      avgTipDist += Math.sqrt(
        Math.pow(tip.x - wrist.x, 2) + 
        Math.pow(tip.y - wrist.y, 2) + 
        Math.pow(tip.z - wrist.z, 2)
      );
    });
    avgTipDist /= 4;

    // Calculate average distance from wrist to MCPs (reference for hand size)
    let avgMcpDist = 0;
    mcps.forEach(mcp => {
      avgMcpDist += Math.sqrt(
        Math.pow(mcp.x - wrist.x, 2) + 
        Math.pow(mcp.y - wrist.y, 2) + 
        Math.pow(mcp.z - wrist.z, 2)
      );
    });
    avgMcpDist /= 4;

    // Heuristic: If tips are closer to wrist than some factor of knuckle distance, it's closed.
    this.isClosed = avgTipDist < (avgMcpDist * 1.3);

    // Update hand position (center of palm approx)
    this.handPosition = { x: 1 - landmarks[9].x, y: landmarks[9].y }; // Mirror x
    
    // Calculate Hand Scale (Depth Estimation)
    // Use distance between Wrist (0) and Middle Finger MCP (9)
    // This distance is relatively stable regardless of finger curl.
    // Normalized coords (0..1). Larger distance = closer to camera.
    const wristToMiddleDist = Math.sqrt(
        Math.pow(landmarks[9].x - landmarks[0].x, 2) + 
        Math.pow(landmarks[9].y - landmarks[0].y, 2)
    );
    // Typical range: 0.1 (far) to 0.4 (very close)
    this.handScale = wristToMiddleDist;

    // Calculate Rotation
    // Vector 1: Wrist to Middle Finger MCP (Palm Up/Down axis basically) -> Y axis
    // Vector 2: Wrist to Index MCP
    // Vector 3: Wrist to Pinky MCP
    // Palm Normal: Cross(Index-Wrist, Pinky-Wrist) -> Z axis
    // Tangent: Cross(Normal, Y) -> X axis
    
    const vWrist = new THREE.Vector3(wrist.x, wrist.y, wrist.z);
    const vMiddle = new THREE.Vector3(landmarks[9].x, landmarks[9].y, landmarks[9].z);
    const vIndex = new THREE.Vector3(landmarks[5].x, landmarks[5].y, landmarks[5].z);
    const vPinky = new THREE.Vector3(landmarks[17].x, landmarks[17].y, landmarks[17].z);

    // Y Axis (Direction of fingers)
    const yAxis = new THREE.Vector3().subVectors(vMiddle, vWrist).normalize();
    // Invert Y because screen y is down
    yAxis.y = -yAxis.y;

    // Temporary vector for Palm Plane calculation (Index to Pinky)
    const vPalmAcross = new THREE.Vector3().subVectors(vPinky, vIndex).normalize();
    vPalmAcross.y = -vPalmAcross.y; // Invert Y

    // Normal (Z Axis) - Out of palm
    // Cross Product of Y (Finger Dir) and PalmAcross (Right to Left)?
    // Let's use standard basis: 
    // Y: Up (Wrist -> Middle)
    // X: Right
    // Z: Forward (Palm Normal)
    
    // Actually, let's construct a rotation matrix.
    // Origin: Wrist
    // Target: Look at Middle Finger
    // Up: Palm Normal
    
    // Let's try to just get a rough orientation.
    // Z axis (Palm Normal) approx = Cross(Wrist->Index, Wrist->Pinky)
    const vWtoI = new THREE.Vector3().subVectors(vIndex, vWrist);
    const vWtoP = new THREE.Vector3().subVectors(vPinky, vWrist);
    
    // Invert Y for screen coords match
    vWtoI.y = -vWtoI.y;
    vWtoP.y = -vWtoP.y;
    // Mirror X? 
    vWtoI.x = -vWtoI.x;
    vWtoP.x = -vWtoP.x;
    
    const zAxis = new THREE.Vector3().crossVectors(vWtoI, vWtoP).normalize();
    
    // Check for NaN
    if (isNaN(zAxis.x) || isNaN(zAxis.y) || isNaN(zAxis.z)) {
        return; // Skip rotation update if invalid
    }
    
    // Re-calculate Y (Wrist -> Middle)
    const yAxisFinal = new THREE.Vector3().subVectors(vMiddle, vWrist);
    yAxisFinal.y = -yAxisFinal.y;
    yAxisFinal.x = -yAxisFinal.x;
    yAxisFinal.normalize();
    
    if (isNaN(yAxisFinal.x) || isNaN(yAxisFinal.y) || isNaN(yAxisFinal.z)) return;

    const xAxis = new THREE.Vector3().crossVectors(yAxisFinal, zAxis).normalize();

    if (isNaN(xAxis.x) || isNaN(xAxis.y) || isNaN(xAxis.z)) return;

    // Construct Matrix
    const matrix = new THREE.Matrix4();
    matrix.makeBasis(xAxis, yAxisFinal, zAxis);
    this.rotation.setFromRotationMatrix(matrix);
  }

  getState() {
    return {
      isClosed: this.isClosed,
      position: this.handPosition,
      rotation: this.rotation,
      scale: this.handScale || 0.2 // Default to 0.2 if undefined
    };
  }

  setOnResults(callback) {
    this.onResultsCallback = callback;
  }
}
