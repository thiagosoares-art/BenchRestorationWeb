using FluentValidation;
using BenchRestoration.Api.Endpoints;

namespace BenchRestoration.Api.Validators;

public class RestoreRequestValidator : AbstractValidator<RestoreRequestDto>
{
    public RestoreRequestValidator()
    {
        RuleFor(x => x.ServerName)
            .NotEmpty().WithMessage("Nome do servidor é obrigatório")
            .MaximumLength(100);

        RuleFor(x => x.InstanceName)
            .NotEmpty().WithMessage("Nome da instância é obrigatório")
            .MaximumLength(100);

        RuleFor(x => x.DatabaseName)
            .NotEmpty().WithMessage("Nome do banco de dados é obrigatório")
            .MaximumLength(128)
            .Matches(@"^[a-zA-Z0-9_\-]+$").WithMessage("Nome do banco contém caracteres inválidos");
    }
}

public class ServerValidator : AbstractValidator<BenchRestoration.Shared.Models.ServerModel>
{
    public ServerValidator()
    {
        RuleFor(x => x.Name)
            .NotEmpty().WithMessage("Nome do servidor é obrigatório")
            .MaximumLength(100)
            .Matches(@"^[a-zA-Z0-9_\-\.]+$").WithMessage("Nome do servidor contém caracteres inválidos");
    }
}

public class DropDatabasesValidator : AbstractValidator<DropDatabasesRequest>
{
    public DropDatabasesValidator()
    {
        RuleFor(x => x.ServerName)
            .NotEmpty().WithMessage("Nome do servidor é obrigatório");

        RuleFor(x => x.InstanceName)
            .NotEmpty().WithMessage("Nome da instância é obrigatório");

        RuleFor(x => x.DatabaseNames)
            .NotEmpty().WithMessage("Selecione ao menos um banco para excluir")
            .Must(dbs => dbs.All(db => !string.IsNullOrWhiteSpace(db)))
            .WithMessage("Nomes de banco inválidos");
    }
}
