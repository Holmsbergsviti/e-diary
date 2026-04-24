import json
import os

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from ..utils import (
    logger,
    _verify_token,
    _make_token,
    _get_profile,
    _ratelimit,
    supabase,
    supabase_auth,
    supabase_admin_auth,
    ediary,
    SUPER_ADMIN_EMAIL,
    MASTER_ADMIN_EMAIL,
    ALL_ADMIN_PERMISSIONS,
)

__all__ = ["login", "me", "upload_avatar"]


# ------------------------------------------------------------------
# Login – authenticate via Supabase Auth
# ------------------------------------------------------------------

@csrf_exempt
@_ratelimit(key="ip", rate="5/m", method="POST", block=False)
def login(request):
    if request.method != "POST":
        return JsonResponse({"message": "Method not allowed"}, status=405)

    # Check rate limit
    if getattr(request, "limited", False):
        return JsonResponse({"message": "Too many login attempts. Please try again later."}, status=429)

    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"message": "Invalid JSON"}, status=400)

    email = data.get("email", "").strip()
    password = data.get("password", "")

    if not email or not password:
        return JsonResponse({"message": "Email and password required"}, status=400)

    # Authenticate with Supabase Auth (use dedicated auth client so the
    # data client's service-role header is never overwritten)
    try:
        auth_response = supabase_auth.auth.sign_in_with_password(
            {"email": email, "password": password}
        )
    except Exception:
        return JsonResponse({"message": "Invalid credentials"}, status=401)

    if not auth_response.user:
        return JsonResponse({"message": "Invalid credentials"}, status=401)

    user_id = str(auth_response.user.id)
    user_email = auth_response.user.email or email

    # Determine role from ediary_schema profile tables
    role, profile = _get_profile(user_id)
    if not role:
        role = "student"
        profile = {"full_name": user_email.split("@")[0], "class_name": ""}

    # Determine admin level from email (super/master override DB value)
    admin_level = profile.get("admin_level", "")
    permissions = profile.get("permissions") or {}
    if role == "admin":
        if user_email.lower() == SUPER_ADMIN_EMAIL:
            admin_level = "super"
            permissions = ALL_ADMIN_PERMISSIONS
        elif user_email.lower() == MASTER_ADMIN_EMAIL:
            admin_level = "master"
            permissions = ALL_ADMIN_PERMISSIONS

    token = _make_token(user_id, role, user_email, admin_level, permissions if role == "admin" else None)

    resp = {
        "token": token,
        "user": {
            "id": user_id,
            "email": user_email,
            "full_name": profile["full_name"],
            "role": role,
            "class_name": profile.get("class_name", ""),
            "profile_picture_url": profile.get("profile_picture_url") or None,
            "avatar_emoji": profile.get("avatar_emoji") or None,
        },
    }
    if role == "admin":
        resp["user"]["admin_level"] = admin_level
        resp["user"]["permissions"] = permissions
    if role == "teacher":
        resp["user"]["contact_email"] = profile.get("contact_email", "")

    return JsonResponse(resp)


# ------------------------------------------------------------------
# Current user profile
# ------------------------------------------------------------------

@csrf_exempt
def me(request):
    payload = _verify_token(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)

    user_id = payload["sub"]

    # PATCH = update email, password, or avatar_emoji
    if request.method in ("PATCH", "PUT"):
        try:
            data = json.loads(request.body)
        except json.JSONDecodeError:
            return JsonResponse({"message": "Invalid JSON"}, status=400)

        updates = {}
        new_email = data.get("email", "").strip()
        new_password = data.get("password", "").strip()
        avatar_emoji = data.get("avatar_emoji")  # Can be string, None, or not present
        clear_avatar = data.get("clear_avatar", False)
        
        # Track if we're updating avatar
        avatar_updated = False

        if new_email:
            updates["email"] = new_email
        if new_password:
            if len(new_password) < 8:
                return JsonResponse({"message": "Password must be at least 8 characters"}, status=400)
            updates["password"] = new_password

        # Handle avatar_emoji update separately (store in profile table)
        if "avatar_emoji" in data or clear_avatar:
            db = ediary()
            role, profile = _get_profile(user_id)
            
            if role in ("student", "teacher", "admin"):
                table = {"student": "students", "teacher": "teachers", "admin": "admins"}[role]
                profile_updates = {}
                
                if avatar_emoji:
                    # Setting an emoji
                    profile_updates["avatar_emoji"] = avatar_emoji
                    # Optionally clear profile picture when emoji is set
                    profile_updates["profile_picture_url"] = None
                    avatar_updated = True
                elif "avatar_emoji" in data and avatar_emoji is None:
                    # Explicitly clearing emoji (avatar_emoji: null)
                    profile_updates["avatar_emoji"] = None
                    avatar_updated = True
                elif clear_avatar:
                    # Clear both emoji and picture
                    profile_updates["avatar_emoji"] = None
                    profile_updates["profile_picture_url"] = None
                    avatar_updated = True
                
                if profile_updates:
                    try:
                        db.table(table).update(profile_updates).eq("id", user_id).execute()
                        logger.info(f"Avatar updated for {role} {user_id}: {profile_updates}")
                    except Exception as e:
                        logger.exception(f"Failed to update avatar for {user_id}")
                        return JsonResponse({"message": f"Failed to update avatar: {str(e)}"}, status=400)
            else:
                return JsonResponse({"message": "Profile not found"}, status=404)

        # Check if at least one update was requested
        if not updates and not avatar_updated:
            logger.warning(f"No updates requested for user {user_id}. Data: {data}")
            return JsonResponse({"message": "Nothing to update"}, status=400)

        # Update email/password via Supabase Auth if needed
        if updates:
            try:
                supabase_admin_auth.auth.admin.update_user_by_id(user_id, updates)
                logger.info(f"Auth updated for {user_id}")
            except Exception:
                logger.exception("Profile update failed")
                return JsonResponse({"message": "Failed to update profile"}, status=400)

        return JsonResponse({"message": "Updated successfully"})

    role, profile = _get_profile(user_id)

    if not role:
        role = "student"
        profile = {
            "full_name": payload.get("email", "").split("@")[0],
            "class_name": "",
        }

    resp = {
        "id": user_id,
        "email": payload.get("email", ""),
        "full_name": profile["full_name"],
        "role": role,
        "class_name": profile.get("class_name", ""),
        "profile_picture_url": profile.get("profile_picture_url") or None,
        "avatar_emoji": profile.get("avatar_emoji") or None,
    }
    if role == "teacher":
        resp["contact_email"] = profile.get("contact_email", "")
    if role == "admin":
        email_lower = payload.get("email", "").lower()
        if email_lower == SUPER_ADMIN_EMAIL:
            resp["admin_level"] = "super"
            resp["permissions"] = ALL_ADMIN_PERMISSIONS
        elif email_lower == MASTER_ADMIN_EMAIL:
            resp["admin_level"] = "master"
            resp["permissions"] = ALL_ADMIN_PERMISSIONS
        else:
            resp["admin_level"] = profile.get("admin_level", "regular")
            resp["permissions"] = profile.get("permissions") or ALL_ADMIN_PERMISSIONS

    return JsonResponse(resp)


# ------------------------------------------------------------------
# Avatar upload
# ------------------------------------------------------------------

AVATAR_BUCKET = "avatars"
AVATAR_MAX_SIZE = 2 * 1024 * 1024  # 2 MB
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
_avatar_bucket_ensured = False


@csrf_exempt
def upload_avatar(request):
    """POST multipart/form-data with file field 'avatar'."""
    if request.method != "POST":
        return JsonResponse({"message": "Only POST allowed"}, status=405)

    payload = _verify_token(request)
    if not payload:
        return JsonResponse({"message": "Unauthorized"}, status=401)

    user_id = payload["sub"]
    role, profile = _get_profile(user_id)
    if role not in ("student", "teacher", "admin"):
        return JsonResponse({"message": "Profile not found"}, status=404)

    avatar_file = request.FILES.get("avatar")
    if not avatar_file:
        return JsonResponse({"message": "No file uploaded"}, status=400)

    if avatar_file.content_type not in ALLOWED_IMAGE_TYPES:
        return JsonResponse({"message": "Only JPEG, PNG, or WebP images are allowed"}, status=400)

    if avatar_file.size > AVATAR_MAX_SIZE:
        return JsonResponse({"message": "Image must be under 2 MB"}, status=400)

    ext = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
    }.get(avatar_file.content_type, "jpg")

    file_path = f"{role}s/{user_id}.{ext}"
    file_bytes = avatar_file.read()

    try:
        # Ensure the storage bucket exists (once per process)
        global _avatar_bucket_ensured
        if not _avatar_bucket_ensured:
            try:
                supabase.storage.get_bucket(AVATAR_BUCKET)
                logger.info("Avatar bucket already exists")
            except Exception as bucket_err:
                logger.info("Avatar bucket not found, creating: %s", bucket_err)
                try:
                    supabase.storage.create_bucket(
                        AVATAR_BUCKET,
                        options={"public": True},
                    )
                    logger.info("Avatar bucket created successfully")
                except Exception as create_err:
                    logger.warning("Bucket creation failed (may already exist): %s", create_err)
            _avatar_bucket_ensured = True

        # Remove previous avatar if it exists (different extension maybe)
        for old_ext in ("jpg", "png", "webp"):
            try:
                supabase.storage.from_(AVATAR_BUCKET).remove([f"{role}s/{user_id}.{old_ext}"])
            except Exception:
                pass

        supabase.storage.from_(AVATAR_BUCKET).upload(
            file_path,
            file_bytes,
            file_options={"content-type": avatar_file.content_type, "upsert": "true"},
        )
    except Exception as exc:
        logger.exception("Avatar upload failed")
        return JsonResponse({"message": f"Upload failed: {exc}"}, status=500)

    # Build public URL
    public_url = f"{SUPABASE_URL}/storage/v1/object/public/{AVATAR_BUCKET}/{file_path}"

    # Update profile_picture_url in the corresponding table
    db = ediary()
    table = {"student": "students", "teacher": "teachers", "admin": "admins"}[role]
    db.table(table).update({"profile_picture_url": public_url}).eq("id", user_id).execute()

    return JsonResponse({"profile_picture_url": public_url})
