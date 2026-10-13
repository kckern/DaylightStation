import { fileExists } from '#system/utils/FileIO.mjs';

export const isContainerRuntime = () => fileExists('/.dockerenv');
