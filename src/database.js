import { neon } from '@neondatabase/serverless';

class PhotoDatabase {
  constructor() {
    this.sql = null;
    this.initialized = false;
    this.connectionString = import.meta.env.VITE_NEON_DATABASE_URL;
  }

  async init() {
    if (!this.connectionString) {
      console.warn('No Neon database URL configured. Photos will not persist.');
      return false;
    }

    try {
      this.sql = neon(this.connectionString);
      
      // Create table if not exists
      await this.sql`
        CREATE TABLE IF NOT EXISTS photos (
          id SERIAL PRIMARY KEY,
          slot INTEGER NOT NULL,
          image_data TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(slot)
        )
      `;
      
      this.initialized = true;
      console.log('✅ Neon database connected and initialized');
      return true;
    } catch (error) {
      console.error('Failed to initialize Neon database:', error);
      return false;
    }
  }

  async savePhoto(slot, imageDataUrl) {
    if (!this.initialized) {
      console.warn('Database not initialized, skipping save');
      return false;
    }

    try {
      // Upsert: insert or update if slot exists
      await this.sql`
        INSERT INTO photos (slot, image_data)
        VALUES (${slot}, ${imageDataUrl})
        ON CONFLICT (slot) 
        DO UPDATE SET image_data = ${imageDataUrl}, created_at = CURRENT_TIMESTAMP
      `;
      console.log(`📸 Photo saved to slot ${slot}`);
      return true;
    } catch (error) {
      console.error('Failed to save photo:', error);
      return false;
    }
  }

  async loadAllPhotos() {
    if (!this.initialized) {
      console.warn('Database not initialized, returning empty');
      return [];
    }

    try {
      const photos = await this.sql`
        SELECT slot, image_data FROM photos ORDER BY slot ASC
      `;
      console.log(`📷 Loaded ${photos.length} photos from database`);
      return photos;
    } catch (error) {
      console.error('Failed to load photos:', error);
      return [];
    }
  }

  async deletePhoto(slot) {
    if (!this.initialized) return false;

    try {
      await this.sql`DELETE FROM photos WHERE slot = ${slot}`;
      return true;
    } catch (error) {
      console.error('Failed to delete photo:', error);
      return false;
    }
  }

  async clearAllPhotos() {
    if (!this.initialized) return false;

    try {
      await this.sql`DELETE FROM photos`;
      console.log('🗑️ All photos cleared from database');
      return true;
    } catch (error) {
      console.error('Failed to clear photos:', error);
      return false;
    }
  }

  isConnected() {
    return this.initialized;
  }
}

// Export singleton instance
export const photoDatabase = new PhotoDatabase();
