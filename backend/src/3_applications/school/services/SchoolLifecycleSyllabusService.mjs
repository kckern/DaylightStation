/** Guarded syllabus query and command boundary. */
export class SchoolLifecycleSyllabusService {
  constructor({ syllabi = null } = {}) { this.syllabi = syllabi; }
  isConfigured() { return Boolean(this.syllabi); }
  list() { return this.syllabi.list(); }
  get(syllabusId) { return this.syllabi.get(syllabusId); }
  save(command) { return this.syllabi.save(command); }
  archive(command) { return this.syllabi.archiveGuarded(command); }
}

export default SchoolLifecycleSyllabusService;
