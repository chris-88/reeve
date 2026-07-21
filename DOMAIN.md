# Custom domain — restore steps

`app.chrisquinn.ie` is **temporarily disabled** so the app is reachable at
https://chris-88.github.io/reeve/ while the .ie registry propagates a
nameserver change.

Setting a custom domain on GitHub Pages makes the `github.io` URL 301-redirect
to it. With DNS not yet resolving, that left the site unreachable everywhere.

## Restore once DNS resolves

Check the registry directly — resolver caches will lie for up to 24h:

```sh
dig +short @192.93.0.4 chrisquinn.ie NS      # want: ns9/ns10.dnsireland.com
dig +short app.chrisquinn.ie                 # want: chris-88.github.io
```

Then:

```sh
echo "app.chrisquinn.ie" > apps/web/public/CNAME
git add -A && git commit -m "Restore custom domain" && git push
gh api -X PUT repos/chris-88/reeve/pages -f 'cname=app.chrisquinn.ie'
# wait for the certificate, then:
gh api -X PUT repos/chris-88/reeve/pages -f 'cname=app.chrisquinn.ie' -F 'https_enforced=true'
```

The DNS record at LetsHost (`app` CNAME -> `chris-88.github.io`) is already
correct and should be left alone.
