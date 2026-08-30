import { EVALUATION_STATES, deepFreeze, fail } from '../support.mjs';

export class RequirementEvaluation {
  constructor(props) {
    if (!EVALUATION_STATES.includes(props.state)) fail('Invalid requirement state', 'INVALID_REQUIREMENT_STATE', 'state');
    Object.assign(this, props, {
      progress: props.progress ? deepFreeze({ ...props.progress }) : null,
      reasons: deepFreeze([...(props.reasons ?? [])]),
      nextBoundary: props.nextBoundary ? deepFreeze({ ...props.nextBoundary }) : null,
    });
    deepFreeze(this);
  }
}

export default RequirementEvaluation;
