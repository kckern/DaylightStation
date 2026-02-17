import { convertVersesToScriptureData, scriptureDataToJSX } from '../../../../../lib/scripture-guide.jsx';

export default function ScriptureSection({ data }) {
  if (!data?.blocks || !Array.isArray(data.blocks)) return null;

  const blocks = convertVersesToScriptureData(data.blocks);
  return (
    <div className="detail-scripture">
      {scriptureDataToJSX(blocks)}
    </div>
  );
}
