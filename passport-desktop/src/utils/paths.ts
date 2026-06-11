/**
 * Utility functions for handling file paths robustly across the application.
 */

/**
 * Resolves the most accurate image path from a member object in the manifest.
 * Since the JSON schema can change or evolve (e.g., from Python backend), 
 * this function gracefully checks all known locations for the image path.
 * 
 * @param member The member object from the manifest
 * @returns A string representing the relative image path, or empty string if not found
 */
export function getEffectiveImagePath(member: any): string {
  if (!member) return '';

  return String(
    // 1. Check modern Image Prep Metadata (Highest priority)
    member.imagePrepMetadata?.editedPath ||
    member.imagePrepMetadata?.scanPath ||
    
    // 2. Check root passport image path (Added by recent Python backend)
    member.passportImagePath ||
    
    // 3. Check legacy root paths
    member.editedPath ||
    member.scanPath ||
    
    // 4. Check OCR Extracted data
    member.passportExtracted?.sourceImagePath ||
    
    ''
  ).trim();
}
