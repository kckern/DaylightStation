export class IStateGatesAdministrationAuthorizer {
  async authorize(_actor, _action, _resource) { throw new Error('IStateGatesAdministrationAuthorizer.authorize must be implemented'); }
}
export default IStateGatesAdministrationAuthorizer;
