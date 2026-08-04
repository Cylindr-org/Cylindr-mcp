import type { PublicStation, Station } from "./types.js";

// Project a full (internal) Station to only its PUBLIC fields. name + region/area
// (location) are always public; every other profile field is gated by its
// per-field visibility flag. The account email is passed in separately (resolved
// from the private Company collection only for opted-in stations) and included
// only when visibility.email is true.
export function toPublicStation(s: Station, email?: string | null): PublicStation {
  const v = s.visibility ?? {};
  const out: PublicStation = {
    id: s.id,
    name: s.name,
    region: s.region,
    area: s.area,
  };
  if (v.phone && s.phone) out.phone = s.phone;
  if (v.websiteUrl && s.websiteUrl) out.websiteUrl = s.websiteUrl;
  if (v.address && s.address) out.address = s.address;
  if (v.socialUrl && s.socialUrl) out.socialUrl = s.socialUrl;
  if (v.cacNumber && s.cacNumber) out.cacNumber = s.cacNumber;
  if (v.email && email) out.email = email;
  return out;
}
