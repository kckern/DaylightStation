/** Outer side-effect boundary for the two admitted persistent lesson actions. */
export class ISchoolLearningActionExecutor {
  /**
   * @returns {Promise<{status:string,message:string,physical:'worksheet'|'none',printed:boolean,effect?:object|null}>}
   */
  async execute(args) { // eslint-disable-line no-unused-vars
    throw new Error('ISchoolLearningActionExecutor.execute must be implemented');
  }
}

export default ISchoolLearningActionExecutor;
