import { ApiError } from "@vitana/api-client";

export interface ConnectedProfilePhoto {
  revision: string;
  updatedAt: string;
  uri: string;
}

interface ProfilePhotoResponse {
  contentBase64: string;
  contentType: string;
  revision: string;
  updatedAt: string;
}

export async function refreshConnectedProfilePhoto(
  getPhoto: () => Promise<ProfilePhotoResponse>,
  cachePhoto: (photo: ProfilePhotoResponse) => string,
  previous?: ConnectedProfilePhoto
): Promise<ConnectedProfilePhoto | undefined> {
  try {
    const photo = await getPhoto();
    return {
      revision: photo.revision,
      updatedAt: photo.updatedAt,
      uri: cachePhoto(photo)
    };
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 404) return undefined;
    return previous;
  }
}