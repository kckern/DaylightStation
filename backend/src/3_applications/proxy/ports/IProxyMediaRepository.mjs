/** Storage/content lookup required by proxy media delivery operations. */
export class IProxyMediaRepository {
  async findContentMedia(_mediaRef) { throw new Error('findContentMedia not implemented'); }
  async findLocalContentMedia(_type, _mediaRef) { throw new Error('findLocalContentMedia not implemented'); }
  async findMediaTreeResource(_mediaRef) { throw new Error('findMediaTreeResource not implemented'); }
}

export default IProxyMediaRepository;
