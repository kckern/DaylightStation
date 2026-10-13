import { convertVersesToScriptureData, scriptureDataToJSX } from "../../../../../../../__capabilities/content-catalog/browser/providers/scripture-guide.jsx";

export default function ScriptureSection({ data }) {
  if (!data?.blocks || !Array.isArray(data.blocks)) return null;

  const blocks = convertVersesToScriptureData(data.blocks);
  return (
    <div className="detail-scripture">
      {scriptureDataToJSX(blocks)}
    </div>
  );
}
