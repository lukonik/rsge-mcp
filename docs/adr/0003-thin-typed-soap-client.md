# Thin typed SOAP client using fetch and fast-xml-parser

Although `WayBillService.asmx?WSDL` is publicly available, RS.ge's SOAP payloads have quirks (such as nested XML documents inside `save_waybill`, Georgian UTF-8 encoding, and numeric error codes) that make WSDL code-gen libraries brittle and slow at startup. We build a thin, explicitly typed SOAP client on Node's built-in `fetch`, `fast-xml-parser`, and Zod schemas so XML serialization is completely transparent and unit tests can run deterministically against recorded XML fixtures.
