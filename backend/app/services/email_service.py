"""
AWS SES email service — sends Account Scorecard results to the prospect.

Usage:
    from app.services.email_service import send_scorecard_email
    send_scorecard_email(
        to_email="seller@example.com",
        brand_name="Acme Brand",
        scorecard_data=listing_health_snapshot,
        audit_id="abc-123",
        share_token="def456...",   # optional
    )

Requires SES_FROM_EMAIL to be set in .env. If empty, the call is a no-op.
boto3 is already a project dependency via the AWS SDK usage elsewhere.
"""
import boto3
from botocore.exceptions import ClientError

from app.core.config import settings

BOOKING_URL = "https://launch.withrevlyn.com/widget/bookings/discovery-call-with-revlyn"

# Inline styles — email clients strip <style> blocks, so everything is inline.
_STATUS_COLOR = {
    "good":     "#22c55e",   # green-500
    "warning":  "#f59e0b",   # amber-400
    "critical": "#ef4444",   # red-500
}
_STATUS_LABEL = {
    "good":    "Good",
    "warning": "Needs Attention",
    "critical": "Critical",
}


def _status_badge(status: str) -> str:
    color = _STATUS_COLOR.get(status, "#94a3b8")
    label = _STATUS_LABEL.get(status, status.title())
    return (
        f'<span style="display:inline-block;padding:2px 10px;border-radius:9999px;'
        f'background:{color}20;color:{color};font-size:12px;font-weight:600;'
        f'border:1px solid {color}40;">{label}</span>'
    )


def _check_cross(value: bool) -> str:
    """Return a styled checkmark or X."""
    if value:
        return '<span style="color:#22c55e;font-weight:700;">&#10003;</span>'
    return '<span style="color:#ef4444;font-weight:700;">&#10007;</span>'


def _build_html(
    brand_name: str,
    scorecard: dict,
    audit_id: str,
    share_token: str | None,
) -> str:
    """Render the full HTML email body."""
    main_asin = scorecard.get("mainAsin", {})
    asin_code  = main_asin.get("asin", "—")
    asin_title = main_asin.get("title", "")

    img_data   = scorecard.get("imageCount", {})
    img_count  = img_data.get("count", "—")
    img_bench  = img_data.get("benchmark", 7)
    img_status = img_data.get("status", "warning")

    aplus_data   = scorecard.get("aPlusContent", {})
    aplus_present = bool(aplus_data.get("present"))
    aplus_status  = aplus_data.get("status", "critical")

    br_data     = scorecard.get("brandRegistry", {})
    br_detected = bool(br_data.get("detected"))
    br_status   = br_data.get("status", "warning")

    rv_data    = scorecard.get("reviewRating", {})
    rv_rating  = rv_data.get("rating", "—")
    rv_count   = rv_data.get("reviewCount", 0)
    rv_cat_avg = rv_data.get("categoryAvg", "—")
    rv_status  = rv_data.get("status", "warning")

    key_finding = scorecard.get("keyFinding", "")

    # Optional "view full report" section
    view_report_html = ""
    if share_token:
        share_url = f"https://app.withrevlyn.com/share/{share_token}"
        view_report_html = f"""
        <tr>
          <td style="padding:0 0 24px 0;text-align:center;">
            <a href="{share_url}"
               style="display:inline-block;padding:12px 28px;background:#1e293b;
                      color:#94a3b8;text-decoration:none;border-radius:8px;
                      font-size:14px;font-weight:600;border:1px solid #334155;">
              View Full Report Online &rarr;
            </a>
          </td>
        </tr>"""

    # Rating display — show one decimal place if it's a number
    try:
        rv_display = f"{float(rv_rating):.1f} / 5.0"
        cat_display = f"(category avg {float(rv_cat_avg):.1f})"
    except (TypeError, ValueError):
        rv_display = str(rv_rating)
        cat_display = ""

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{brand_name} — Your Amazon Account Scorecard</title>
</head>
<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;min-height:100vh;">
    <tr>
      <td align="center" style="padding:40px 16px;">

        <!-- Card -->
        <table width="600" cellpadding="0" cellspacing="0"
               style="background:#1e293b;border-radius:16px;border:1px solid #334155;
                      max-width:600px;width:100%;overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);
                       padding:36px 40px 28px;border-bottom:1px solid #334155;">
              <p style="margin:0 0 8px;color:#f59e0b;font-size:12px;font-weight:700;
                        letter-spacing:2px;text-transform:uppercase;">Revlyn — Amazon Intelligence</p>
              <h1 style="margin:0 0 6px;color:#f8fafc;font-size:26px;font-weight:800;line-height:1.2;">
                Your Account Scorecard
              </h1>
              <p style="margin:0;color:#94a3b8;font-size:15px;">
                {brand_name}
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0">

                <!-- Top ASIN row -->
                <tr>
                  <td style="padding:0 0 24px 0;">
                    <p style="margin:0 0 4px;color:#64748b;font-size:11px;font-weight:600;
                               text-transform:uppercase;letter-spacing:1px;">Top Listing Analysed</p>
                    <p style="margin:0;color:#f59e0b;font-size:14px;font-weight:700;">{asin_code}</p>
                    {f'<p style="margin:2px 0 0;color:#94a3b8;font-size:13px;">{asin_title}</p>' if asin_title else ''}
                  </td>
                </tr>

                <!-- Score rows table -->
                <tr>
                  <td style="padding:0 0 24px 0;">
                    <table width="100%" cellpadding="0" cellspacing="0"
                           style="background:#0f172a;border-radius:10px;border:1px solid #1e293b;
                                  border-collapse:separate;border-spacing:0;overflow:hidden;">

                      <!-- Images -->
                      <tr style="border-bottom:1px solid #1e293b;">
                        <td style="padding:14px 18px;color:#94a3b8;font-size:13px;font-weight:500;
                                   width:50%;border-bottom:1px solid #1e293b;">
                          Listing Images
                        </td>
                        <td style="padding:14px 18px;border-bottom:1px solid #1e293b;">
                          <span style="color:#f8fafc;font-size:14px;font-weight:600;">
                            {img_count} <span style="color:#475569;font-weight:400;font-size:12px;">/ {img_bench} benchmark</span>
                          </span>
                          &nbsp;&nbsp;{_status_badge(img_status)}
                        </td>
                      </tr>

                      <!-- A+ Content -->
                      <tr>
                        <td style="padding:14px 18px;color:#94a3b8;font-size:13px;font-weight:500;
                                   border-bottom:1px solid #1e293b;">
                          A+ Content
                        </td>
                        <td style="padding:14px 18px;border-bottom:1px solid #1e293b;">
                          {_check_cross(aplus_present)}
                          <span style="color:#f8fafc;font-size:13px;margin-left:8px;">
                            {"Present" if aplus_present else "Not detected"}
                          </span>
                          &nbsp;&nbsp;{_status_badge(aplus_status)}
                        </td>
                      </tr>

                      <!-- Brand Registry -->
                      <tr>
                        <td style="padding:14px 18px;color:#94a3b8;font-size:13px;font-weight:500;
                                   border-bottom:1px solid #1e293b;">
                          Brand Registry
                        </td>
                        <td style="padding:14px 18px;border-bottom:1px solid #1e293b;">
                          {_check_cross(br_detected)}
                          <span style="color:#f8fafc;font-size:13px;margin-left:8px;">
                            {"Registered" if br_detected else "Not detected"}
                          </span>
                          &nbsp;&nbsp;{_status_badge(br_status)}
                        </td>
                      </tr>

                      <!-- Reviews -->
                      <tr>
                        <td style="padding:14px 18px;color:#94a3b8;font-size:13px;font-weight:500;">
                          Review Rating
                        </td>
                        <td style="padding:14px 18px;">
                          <span style="color:#f8fafc;font-size:14px;font-weight:600;">
                            {rv_display}
                            <span style="color:#475569;font-weight:400;font-size:12px;">
                              &nbsp;{rv_count:,} reviews &nbsp;{cat_display}
                            </span>
                          </span>
                          &nbsp;&nbsp;{_status_badge(rv_status)}
                        </td>
                      </tr>

                    </table>
                  </td>
                </tr>

                <!-- Key Finding callout -->
                {f"""
                <tr>
                  <td style="padding:0 0 28px 0;">
                    <table width="100%" cellpadding="0" cellspacing="0"
                           style="background:#451a03;border:1px solid #78350f;border-radius:10px;">
                      <tr>
                        <td style="padding:16px 20px;">
                          <p style="margin:0 0 6px;color:#f59e0b;font-size:11px;font-weight:700;
                                     text-transform:uppercase;letter-spacing:1px;">Key Finding</p>
                          <p style="margin:0;color:#fde68a;font-size:14px;line-height:1.6;">
                            {key_finding}
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                """ if key_finding else ""}

                <!-- CTA -->
                <tr>
                  <td style="padding:0 0 16px 0;text-align:center;">
                    <p style="margin:0 0 16px;color:#cbd5e1;font-size:15px;line-height:1.6;">
                      Want to know exactly how much revenue you're leaving on the table —
                      and a clear plan to fix it?
                    </p>
                    <a href="{BOOKING_URL}"
                       style="display:inline-block;padding:16px 36px;
                              background:linear-gradient(135deg,#f59e0b,#d97706);
                              color:#0f172a;text-decoration:none;border-radius:10px;
                              font-size:16px;font-weight:800;letter-spacing:0.3px;">
                      Book a Free Strategy Call &rarr;
                    </a>
                  </td>
                </tr>

                <!-- Optional view report link -->
                {view_report_html}

              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px 28px;border-top:1px solid #1e293b;">
              <p style="margin:0;color:#334155;font-size:12px;text-align:center;line-height:1.6;">
                This scorecard was generated by
                <a href="https://withrevlyn.com" style="color:#f59e0b;text-decoration:none;">Revlyn</a>
                based on publicly available Amazon data.
                &nbsp;&bull;&nbsp;
                You requested this scorecard at {settings.SES_FROM_EMAIL or "revlyn.com"}.
              </p>
            </td>
          </tr>

        </table>
        <!-- /Card -->

      </td>
    </tr>
  </table>
</body>
</html>"""

    return html


def send_scorecard_email(
    to_email: str,
    brand_name: str,
    scorecard_data: dict,
    audit_id: str,
    share_token: str | None = None,
) -> bool:
    """
    Send the Account Scorecard email via AWS SES.

    Returns True on success, False on any failure (caller should never raise).
    Silently skips if SES_FROM_EMAIL is not configured.
    """
    from_email = settings.SES_FROM_EMAIL.strip()
    if not from_email:
        print("[email] SES_FROM_EMAIL not configured — skipping email send")
        return False

    if not to_email or "@" not in to_email:
        print(f"[email] Invalid to_email={to_email!r} — skipping")
        return False

    subject = f"{brand_name} \u2014 Your Amazon Account Scorecard"
    html_body = _build_html(brand_name, scorecard_data, audit_id, share_token)
    text_body = (
        f"Your Amazon Account Scorecard for {brand_name}\n\n"
        f"We've analysed your Amazon store and prepared your listing health scorecard.\n\n"
        f"Book a free strategy call to review the findings: {BOOKING_URL}\n"
    )
    if share_token:
        text_body += f"\nView your full report: https://app.withrevlyn.com/share/{share_token}\n"

    try:
        ses = boto3.client(
            "ses",
            region_name=settings.AWS_REGION,
            aws_access_key_id=settings.AWS_ACCESS_KEY_ID or None,
            aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY or None,
        )
        ses.send_email(
            Source=from_email,
            Destination={"ToAddresses": [to_email]},
            Message={
                "Subject": {"Data": subject, "Charset": "UTF-8"},
                "Body": {
                    "Text": {"Data": text_body, "Charset": "UTF-8"},
                    "Html":  {"Data": html_body, "Charset": "UTF-8"},
                },
            },
        )
        print(f"[email] Scorecard sent to {to_email} for brand={brand_name!r} audit={audit_id}")
        return True
    except ClientError as e:
        code = e.response["Error"]["Code"]
        msg  = e.response["Error"]["Message"]
        print(f"[email] SES ClientError {code}: {msg}")
        return False
    except Exception as e:
        print(f"[email] Unexpected error: {type(e).__name__}: {e}")
        return False
