# Public website indexing: release checklist

The public website is noindex until the owner approves indexing. Two locks control it:

1. **Approval flag.** `SITE_INDEXING_APPROVED=true` in the public-site production project makes the built HTML say
   `index, follow`. This is one input. It never enables indexing alone.
2. **HTTP header.** `site/vercel.json` sends `X-Robots-Tag: noindex, nofollow` on every response. While it is present,
   crawlers see noindex, and the stricter directive wins.

Indexing is enabled only when both locks are released. Neither step is automatic.

Preview, development and any build without `VERCEL_ENV=production` always stay noindex.

## Before releasing indexing

Each item must be verified and recorded in the release PR.

- [ ] Real published content is live. Every public page shows approved copy, with no sample banner, no "sample" tag and
      no placeholder text. Check the home, about, events, rhapsody, foundation school, new-here, blog and contact pages.
- [ ] Backend rows are published and reviewed. A configured URL and key are not enough.
- [ ] The owner has approved indexing in writing, in the release PR.
- [ ] The `X-Robots-Tag` entry is removed from `site/vercel.json` in a reviewed PR, and `site/src/__tests__/indexing.test.ts`
      is updated in the same PR.
- [ ] `SITE_INDEXING_APPROVED=true` is set only in the public-site production project. It is not set in preview.
- [ ] The production deployment is rebuilt after both changes.

## After the production deployment

Check the final directive in both places. Both must show `index, follow` only after release.

- [ ] Public site production URL (`https://blw-york-public-site.vercel.app/`):
      - `curl -sI https://blw-york-public-site.vercel.app/ | grep -i x-robots-tag`: expect no header.
      - View source: `<meta name="robots" content="index, follow" />` is present.
- [ ] Hub route (`https://<hub-domain>/site/`):
      - Same header and meta checks through the rewrite. If the header still appears there, stop and investigate
        before announcing the release.
- [ ] Preview deployment of the same commit still shows `noindex, nofollow` in both the header and the meta.

## Rollback

Set `SITE_INDEXING_APPROVED` back to anything other than `true`, or restore the `X-Robots-Tag` header in a reviewed PR,
then redeploy. Either change alone returns the site to noindex.
