import { EVALUATION_STATES, deepFreeze, fail } from '../support.mjs';

export class GateEvaluation {
  constructor(props) {
    if (!EVALUATION_STATES.includes(props.state)) fail('Invalid gate state', 'INVALID_GATE_STATE', 'state');
    Object.assign(this, props, {
      progress: props.progress ? deepFreeze({ ...props.progress }) : null,
      reasons: deepFreeze([...(props.reasons ?? [])]),
      nextBoundary: props.nextBoundary ? deepFreeze({ ...props.nextBoundary }) : null,
    });
    deepFreeze(this);
  }
}

export default GateEvaluation;
