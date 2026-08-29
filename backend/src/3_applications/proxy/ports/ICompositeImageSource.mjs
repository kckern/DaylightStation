/** Source gateway for the images used to render a composite hero. */
export class ICompositeImageSource {
  async loadImages(_id, _page) { throw new Error('loadImages not implemented'); }
}

export default ICompositeImageSource;
