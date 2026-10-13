import { GetCanvasImage } from '../application/canvas/usecases/GetCanvasImage.mjs';
import { FilesystemCanvasImageRepository } from '../adapters/FilesystemCanvasImageRepository.mjs';

export function createCanvasImageUseCase(canvasBasePath) {
  return canvasBasePath
      ? new GetCanvasImage({ repository: new FilesystemCanvasImageRepository({ rootDir: canvasBasePath }) })
      : null;
}
