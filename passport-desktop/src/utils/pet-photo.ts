export const petPhotoKey = 'entrymate.pet.photo';
export const defaultPetPhoto = '/workflow/portraits/import.png';

export function readPetPhoto() {
  try {
    const saved = localStorage.getItem(petPhotoKey) || '';
    return saved.length <= 32768 && /^data:image\/(webp|png|jpeg);base64,/.test(saved) ? saved : defaultPetPhoto;
  } catch {
    return defaultPetPhoto;
  }
}
