/** The participant consumer owns only explicitly casual Charades definitions. */
export function isParticipantCharades(definition) {
  return definition?.experience?.id === 'charades'
    && definition?.rule_module?.id === 'activity-party'
    && definition.competition === false;
}
