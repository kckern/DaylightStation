export class IRequirementsAdministrationAuthorizer {
  async authorize(_actor, _action, _resource) { throw new Error('IRequirementsAdministrationAuthorizer.authorize must be implemented'); }
}
export default IRequirementsAdministrationAuthorizer;
