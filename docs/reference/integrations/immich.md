

## 1. Filter by Star Rating (Range)

Currently, the Immich API doesn't have a direct `ratingMin` or `ratingMax` parameter. You can filter by a **specific** rating, but for a **range**, you generally have to perform a metadata search.

* **Endpoint:** `POST /search/metadata`
* **Method:** You can pass a single rating in the search, but for a range (e.g., 3 to 5 stars), you would typically need to fetch them and filter on the client side, or perform multiple queries for 3, 4, and 5 stars.
* **Logic:**
```json
// Example: Searching for exactly 5 stars
{
  "isFavorite": true, // Often used in lieu of high ratings
  "stars": 5
}

```



## 2. Location Radius (Geofencing)

Immich uses **Reverse Geocoding** (City, State, Country) for its primary search, but for a specific radius around coordinates, you use the Map/Search endpoints.

* **Endpoint:** `GET /search` (using the `q` query string) or `GET /map/markers`
* **The "Radius" Trick:** Immich supports geocoding search strings. If you search for a city name, it returns assets from that area. For a strict radius (e.g., "within 5km of X"), the API doesn't currently expose a `lat/long/radius` POST body.
* **Workaround:** Most developers retrieve all assets with coordinates via `GET /timeline/bucket?withCoordinates=true` and then calculate the distance using the **Haversine formula** on the client side.

## 3. Tagged People

This is well-supported via the `personId`.

* **Endpoint:** `POST /search/metadata`
* **Parameter:** `personIds` (Array of UUIDs)
* **Example Payload:**
```json
{
  "personIds": ["uuid-of-person-1", "uuid-of-person-2"]
}

```


*Note: This usually acts as an "OR" filter. If you need "AND" (both people in the same photo), you'll need to filter the results programmatically.*

## 4. Video Length (Duration)

Immich stores the duration in the asset metadata, but the search API doesn't have a `durationMin/Max` filter yet.

* **Endpoint:** `GET /assets/{id}` or `POST /search/metadata`
* **How to do it:** 1.  Perform a search with `type: VIDEO`.
2.  The response objects include a `duration` field (formatted as `HH:mm:ss.SSS` or similar).
3.  Filter these results in your code to match your desired range (e.g., `duration > 00:00:30`).

---

### Summary Table for API Implementation

| Filter | Best Endpoint | Parameter / Strategy |
| --- | --- | --- |
| **Star Rating** | `/search/metadata` | Use `stars` (exact) or filter range in client. |
| **Location** | `/search/metadata` | Use `city`, `state`, or `country`. |
| **People** | `/search/metadata` | Pass `personIds` array. |
| **Video Length** | `/search` | Set `type=VIDEO`, then filter `duration` in response. |

### Pro-Tip: The "Smart Search" String

Immich's `POST /search/smart` (CLIP search) allows for natural language. Sometimes it's faster to query `"videos of sunsets longer than 1 minute"`—though for strict API logic, the metadata search described above is more reliable.

