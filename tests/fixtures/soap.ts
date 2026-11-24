export function soapEnvelope(bodyXml: string): string {
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" ` +
    `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xmlns:xsd="http://www.w3.org/2001/XMLSchema">` +
    `<soap:Body>${bodyXml}</soap:Body>` +
    `</soap:Envelope>`
  );
}

export function checkServiceUserSuccessXml(
  unId = 731937,
  serviceUserId = 20350,
): string {
  return soapEnvelope(
    `<chek_service_userResponse xmlns="http://tempuri.org/">` +
      `<chek_service_userResult>true</chek_service_userResult>` +
      `<un_id>${unId}</un_id>` +
      `<s_user_id>${serviceUserId}</s_user_id>` +
      `</chek_service_userResponse>`,
  );
}

export function checkServiceUserInvalidXml(): string {
  return soapEnvelope(
    `<chek_service_userResponse xmlns="http://tempuri.org/">` +
      `<chek_service_userResult>false</chek_service_userResult>` +
      `<un_id>-3</un_id>` +
      `<s_user_id>-3</s_user_id>` +
      `</chek_service_userResponse>`,
  );
}

export function soapFaultXml(faultCode: string, faultString: string): string {
  return soapEnvelope(
    `<soap:Fault>` +
      `<faultcode>${faultCode}</faultcode>` +
      `<faultstring>${faultString}</faultstring>` +
      `<detail />` +
      `</soap:Fault>`,
  );
}

export function xmlResponse(xml: string, status = 200): Response {
  return new Response(xml, {
    status,
    headers: { 'content-type': 'text/xml; charset=utf-8' },
  });
}
