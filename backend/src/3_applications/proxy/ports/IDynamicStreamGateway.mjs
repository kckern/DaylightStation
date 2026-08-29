/** Gateway for safely opening one dynamic remote media stream. */
export class IDynamicStreamGateway {
  async open(_request) { throw new Error('IDynamicStreamGateway.open not implemented'); }
}

export default IDynamicStreamGateway;
