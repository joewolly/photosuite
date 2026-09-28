// Test-only DOM parser. Production uses the native WebKit/WebView DOMParser.
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
export function installXmlDom() {
  globalThis.DOMParser = class StrictDOMParser {
    parseFromString(xml, type) {
      return new DOMParser({ onError: () => { throw new Error("Invalid XML"); } }).parseFromString(xml, type);
    }
  };
  globalThis.XMLSerializer = XMLSerializer;
}
