/** Outbound capability for printing image bytes without exposing temporary storage. */
export class IImagePrintGateway {
  async print(_printer, _image) { throw new Error('IImagePrintGateway.print must be implemented'); }
}

export default IImagePrintGateway;
