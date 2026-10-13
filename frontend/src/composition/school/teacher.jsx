import React from 'react';
import TeacherConsole from '../../../../__app_modules/school/browser/teacher.mjs';
import PianoProgramsPanel from '../../../../__app_modules/piano/browser/teacher-programs.mjs';

/** Installed teacher view retains the actual School shell and Piano panel. */
export default function InstalledTeacherConsole(props) {
  return React.createElement(TeacherConsole, { ...props, PianoProgramsPanel });
}
