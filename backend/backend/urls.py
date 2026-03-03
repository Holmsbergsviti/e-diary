from django.http import JsonResponse
from django.urls import path, include


def health(request):
    return JsonResponse({"status": "ok"})


urlpatterns = [
    path("", health),
    path("api/", include("api.urls")),
]
