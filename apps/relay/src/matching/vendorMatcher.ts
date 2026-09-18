export interface VendorStatus {
  vendorMatch: boolean;
  vendorId?: string;
  vendorName?: string;
  vendorEmail?: string;
  senderType?: string;
}

export async function classifySenderVendorStatus(fromEmail: string, vendorsMap: Map<string, any> | null): Promise<VendorStatus> {
  const emailLower = fromEmail.toLowerCase().trim();
  
  if (vendorsMap && vendorsMap.has(emailLower)) {
    const vendor = vendorsMap.get(emailLower);
    return {
      vendorMatch: true,
      vendorId: vendor.id,
      vendorName: vendor.name,
      vendorEmail: vendor.email,
      senderType: 'vendor'
    };
  }

  return {
    vendorMatch: false,
    senderType: 'external'
  };
}
