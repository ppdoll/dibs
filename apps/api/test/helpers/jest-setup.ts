/**
 * 통합 테스트 프로세스 부트스트랩.
 *
 * 서비스 클래스에 붙은 `@Injectable()` 과 DTO 의 `@ApiProperty()` 는 emitDecoratorMetadata 로
 * `Reflect.metadata(...)` 호출을 만든다. main.ts 가 맨 위에서 하는 일을 여기서도 해주지 않으면
 * 테스트가 서비스를 그냥 `new` 하는 순간 `Reflect.getMetadata is not a function` 으로 죽는다.
 */
import 'reflect-metadata';
