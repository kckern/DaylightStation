import React from 'react';
import TeacherConsole from '../../../../modules/school/browser/teacher.mjs';
import PianoProgramsPanel from '../../../../modules/piano/browser/teacher-programs.mjs';

/** Installed teacher view retains the actual School shell and Piano panel. */
export default function InstalledTeacherConsole(props) {
  return React.createElement(TeacherConsole, { ...props, PianoProgramsPanel });
}
