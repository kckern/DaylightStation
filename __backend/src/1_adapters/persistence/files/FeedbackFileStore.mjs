import { deleteFile, deleteYaml, fileExists, listDirs, listYamlFiles, loadYaml, saveYaml, writeBinary } from '#system/utils/FileIO.mjs';

/** Filesystem implementation of the feedback application's byte-storage port. */
export class FeedbackFileStore {
  writeBinary(filePath, content) {
    writeBinary(filePath, content);
  }

  listDirectories(dirPath) {
    return listDirs(dirPath);
  }

  removeFile(filePath) {
    return deleteFile(filePath);
  }

  exists(filePath) {
    return fileExists(filePath);
  }

  loadYaml(filePath) {
    return loadYaml(filePath);
  }

  saveYaml(filePath, content) {
    saveYaml(filePath, content);
  }

  listYamlFiles(dirPath, options) {
    return listYamlFiles(dirPath, options);
  }

  deleteYaml(basePath) {
    return deleteYaml(basePath);
  }
}

export default FeedbackFileStore;
