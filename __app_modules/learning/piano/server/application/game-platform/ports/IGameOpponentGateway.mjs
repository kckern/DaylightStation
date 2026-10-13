/** Port implemented by game-specific engine adapters. */
export class IGameOpponentGateway {
  chooseMove(_request) { throw new Error('IGameOpponentGateway.chooseMove not implemented'); }
  dispose() {}
}
