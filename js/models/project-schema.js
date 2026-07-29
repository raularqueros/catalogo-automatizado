import { generateId, getTimestamp, getDeviceId } from '../utils.js?v=20260729-final-integration-v1';
import CONFIG from '../config.js?v=20260729-final-integration-v1';

export function createProject(name = CONFIG.DEFAULT_PROJECT_NAME) {
  const now = getTimestamp();
  return {
    projectId: generateId(),
    name,
    schemaVersion: CONFIG.SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    currency: CONFIG.DEFAULT_CURRENCY,
    locale: CONFIG.DEFAULT_LOCALE,
    categories: [],
    visualSettings: {
      primaryColor: null,
      logoImageId: null
    },
    syncMetadata: {
      status: 'local',
      cloudProvider: null,
      cloudProjectId: null,
      lastLocalUpdate: now,
      lastCloudSync: null,
      deviceId: getDeviceId(),
      errorMessage: null
    }
  };
}
