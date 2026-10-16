using BenchRestoration.Api.Data;
using BenchRestoration.Shared.Models;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Mvc;
using System.Security.Claims;

namespace BenchRestoration.Api.Endpoints;

public static class AuthEndpoints
{
    private static readonly object SetupLock = new();
    private static readonly List<string> AdminPermissions =
    [
        "restaurar", "historico", "lote", "excluir",
        "fila", "servidor", "dashboard", "configuracoes"
    ];

    public static void MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var auth = app.MapGroup("/api/auth");

        auth.MapGet("/setup-status", (AppDbContext db) =>
            Results.Ok(new { setupRequired = !db.HasUsers() }));

        auth.MapPost("/setup", (CreateUserRequest request, AppDbContext db) =>
        {
            lock (SetupLock)
            {
                if (db.HasUsers())
                    return Results.Conflict(new { message = "A configuração inicial já foi concluída" });

                if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrWhiteSpace(request.Password))
                    return Results.BadRequest(new { message = "Usuário e senha são obrigatórios" });

                if (request.Password.Length < 12)
                    return Results.BadRequest(new { message = "A senha deve ter pelo menos 12 caracteres" });

                var userId = db.CreateUser(
                    request.Username.Trim(),
                    AppDbContext.HashPassword(request.Password),
                    "Administrador");
                db.SetUserPermissions(userId, AdminPermissions);

                return Results.Ok(new { success = true });
            }
        });

        auth.MapPost("/login", async (HttpContext httpContext, [FromBody] LoginRequest request, AppDbContext db, FailedLoginTracker tracker) =>
        {
            if (tracker.IsBlocked(request.Username))
                return Results.Json(new LoginResponse { Success = false, Message = "Conta temporariamente bloqueada. Tente novamente em 15 minutos." }, statusCode: 429);

            var user = db.GetUserByUsername(request.Username);
            if (user == null || !AppDbContext.VerifyPassword(request.Password, user.PasswordHash))
            {
                tracker.RecordFailure(request.Username);
                return Results.Json(new LoginResponse { Success = false, Message = "Usuário ou senha inválidos" }, statusCode: 401);
            }

            if (!user.IsActive)
                return Results.Json(new LoginResponse { Success = false, Message = "Este usuário não tem mais acesso ao sistema" }, statusCode: 401);

            tracker.Reset(request.Username);

            // Upgrade legacy PBKDF2 hash to BCrypt
            if (!AppDbContext.IsBcryptHash(user.PasswordHash))
            {
                var bcryptHash = AppDbContext.HashPassword(request.Password);
                db.UpdateUser(user.Id, bcryptHash, null, null);
            }

            var claims = new List<Claim>
            {
                new(ClaimTypes.NameIdentifier, user.Id.ToString()),
                new(ClaimTypes.Name, user.Username),
                new(ClaimTypes.Role, user.Role)
            };

            foreach (var perm in user.Permissions)
                claims.Add(new Claim("Permission", perm));

            var identity = new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme);
            var principal = new ClaimsPrincipal(identity);

            await httpContext.SignInAsync(principal, new AuthenticationProperties
            {
                IsPersistent = true,
                ExpiresUtc = request.RememberMe ? DateTime.UtcNow.AddDays(7) : DateTime.UtcNow.AddHours(8)
            });

            return Results.Ok(new LoginResponse
            {
                Success = true,
                User = new UserInfo
                {
                    Id = user.Id,
                    Username = user.Username,
                    Role = user.Role,
                    Permissions = user.Permissions
                }
            });
        });

        auth.MapPost("/logout", async (HttpContext httpContext) =>
        {
            await httpContext.SignOutAsync();
            return Results.Ok(new { success = true });
        });

        auth.MapGet("/me", (HttpContext httpContext, AppDbContext db) =>
        {
            var userIdClaim = httpContext.User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (userIdClaim == null)
                return Results.Json(new LoginResponse { Success = false, Message = "Não autenticado" }, statusCode: 401);

            var user = db.GetUserById(int.Parse(userIdClaim));
            if (user == null)
                return Results.Json(new LoginResponse { Success = false, Message = "Usuário não encontrado" }, statusCode: 401);

            return Results.Ok(new LoginResponse
            {
                Success = true,
                User = new UserInfo
                {
                    Id = user.Id,
                    Username = user.Username,
                    Role = user.Role,
                    Permissions = user.Permissions
                }
            });
        });

        auth.MapPost("/change-password", (HttpContext httpContext, [FromBody] ChangePasswordRequest request, AppDbContext db) =>
        {
            var userIdClaim = httpContext.User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (userIdClaim == null)
                return Results.Json(new { message = "Não autenticado" }, statusCode: 401);

            var user = db.GetUserById(int.Parse(userIdClaim));
            if (user == null)
                return Results.Json(new { message = "Usuário não encontrado" }, statusCode: 404);

            if (!AppDbContext.VerifyPassword(request.CurrentPassword, user.PasswordHash))
                return Results.Json(new { message = "Senha atual incorreta" }, statusCode: 400);

            if (string.IsNullOrWhiteSpace(request.NewPassword))
                return Results.Json(new { message = "Informe a nova senha" }, statusCode: 400);

            var hash = AppDbContext.HashPassword(request.NewPassword);
            db.UpdateUser(user.Id, hash, null, null);
            return Results.Ok(new { success = true, message = "Senha alterada com sucesso" });
        });

        var users = app.MapGroup("/api/auth/users").RequireAuthorization();

        users.MapGet("/", (AppDbContext db) =>
        {
            var usersList = db.GetUsers();
            return Results.Ok(usersList.Select(u => new
            {
                u.Id,
                u.Username,
                u.Role,
                u.IsActive,
                u.CreatedAt,
                u.Permissions
            }));
        });

        users.MapPost("/", (HttpContext httpContext, [FromBody] CreateUserRequest request, AppDbContext db) =>
        {
            if (!httpContext.User.IsInRole("Administrador"))
                return Results.Json(new { message = "Apenas administradores podem criar usuários" }, statusCode: 403);

            if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrWhiteSpace(request.Password))
                return Results.Json(new { message = "Usuário e senha são obrigatórios" }, statusCode: 400);

            var existing = db.GetUserByUsername(request.Username);
            if (existing != null)
                return Results.Json(new { message = "Usuário já existe" }, statusCode: 409);

            var hash = AppDbContext.HashPassword(request.Password);
            var userId = db.CreateUser(request.Username, hash, request.Role);
            db.SetUserPermissions(userId, request.Permissions);

            var user = db.GetUserById(userId);
            return Results.Created($"/api/auth/users/{userId}", new
            {
                user!.Id,
                user.Username,
                user.Role,
                user.IsActive,
                user.CreatedAt,
                user.Permissions
            });
        });

        users.MapPut("/{id:int}", (HttpContext httpContext, int id, [FromBody] UpdateUserRequest request, AppDbContext db) =>
        {
            var currentUserId = int.Parse(httpContext.User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
            var isAdmin = httpContext.User.IsInRole("Administrador");

            if (!isAdmin)
            {
                if (id != currentUserId)
                    return Results.Json(new { message = "Você só pode alterar sua própria senha" }, statusCode: 403);

                if (string.IsNullOrWhiteSpace(request.Password))
                    return Results.Json(new { message = "Informe a nova senha" }, statusCode: 400);

                var hash = AppDbContext.HashPassword(request.Password);
                db.UpdateUser(id, hash, null, null);
                return Results.Ok(new { success = true, message = "Senha alterada com sucesso" });
            }

            string? passwordHash = request.Password != null ? AppDbContext.HashPassword(request.Password) : null;

            if (request.Role != null && request.Role != "Administrador" && request.Role != "Usuario")
                return Results.Json(new { message = "Role inválida" }, statusCode: 400);

            db.UpdateUser(id, passwordHash, request.Role, request.IsActive);

            if (request.Permissions != null)
                db.SetUserPermissions(id, request.Permissions);

            return Results.Ok(new { success = true });
        });

        users.MapDelete("/{id:int}", (HttpContext httpContext, int id, AppDbContext db) =>
        {
            if (!httpContext.User.IsInRole("Administrador"))
                return Results.Json(new { message = "Apenas administradores podem excluir usuários" }, statusCode: 403);

            var currentUserId = int.Parse(httpContext.User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
            if (id == currentUserId)
                return Results.Json(new { message = "Não é possível excluir o próprio usuário" }, statusCode: 400);

            var users = db.GetUsers();
            var adminCount = users.Count(u => u.Role == "Administrador" && u.IsActive);
            if (adminCount <= 1 && users.Any(u => u.Id == id && u.Role == "Administrador"))
                return Results.Json(new { message = "Deve haver pelo menos um administrador ativo" }, statusCode: 400);

            db.DeleteUser(id);
            return Results.Ok(new { success = true });
        });
    }

    public static UserModel? GetUserById(this AppDbContext db, int id)
    {
        using var conn = db.CreateConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT Id, Username, PasswordHash, Role, IsActive, CreatedAt FROM Users WHERE Id = @id";
        cmd.Parameters.AddWithValue("@id", id);
        using var reader = cmd.ExecuteReader();
        if (reader.Read())
        {
            var user = new UserModel
            {
                Id = reader.GetInt32(0),
                Username = reader.GetString(1),
                PasswordHash = reader.GetString(2),
                Role = reader.GetString(3),
                IsActive = reader.GetInt32(4) == 1,
                CreatedAt = DateTime.Parse(reader.GetString(5))
            };
            user.Permissions = db.GetUserPermissions(user.Id);
            return user;
        }
        return null;
    }
}
